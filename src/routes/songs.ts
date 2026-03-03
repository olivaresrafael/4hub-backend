import { Router, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';
import { randomBytes } from 'crypto';

const router = Router();

function getSupabaseWithAuth(req: AuthRequest) {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1] || '';
  
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

// =============================================
// SPECIFIC ROUTES (must come before /:id routes)
// =============================================

// GET /api/songs - List user's songs
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('songs')
      .select('*')
      .eq('owner_id', req.userId)
      .order('updated_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/songs/shared - Get songs shared with current user
router.get('/shared', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabaseAuth = getSupabaseWithAuth(req);
    
    const { data, error } = await supabaseAuth
      .from('collaborators')
      .select(`
        permission,
        songs (*)
      `)
      .eq('user_id', req.userId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const songs = (data || []).map((item: any) => ({
      ...item.songs,
      collaborator_permission: item.permission,
      is_collaborator: true,
    }));

    return res.json(songs);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/songs/public/list - List public songs
router.get('/public/list', async (req: AuthRequest, res: Response) => {
  try {
    const { genre, key, sort, limit = 20, offset = 0 } = req.query;
    
    let query = supabase
      .from('songs')
      .select('id, title, artist, original_key, genre, tempo, owner_id, created_at, updated_at')
      .eq('is_public', true);

    if (genre) {
      query = query.eq('genre', genre as string);
    }
    if (key) {
      query = query.eq('original_key', key as string);
    }

    if (sort === 'popular') {
      query = query.order('created_at', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    query = query.range(Number(offset), Number(offset) + Number(limit) - 1);

    const { data, error } = await query;

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json(data || []);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/share/:token - Access song via share token
router.get('/share/:token', async (req: AuthRequest, res: Response) => {
  try {
    const { data: shareToken, error } = await supabase
      .from('share_tokens')
      .select('*, songs(*)')
      .eq('token', req.params.token)
      .single();

    if (error || !shareToken) {
      return res.status(404).json({ error: 'Invalid share link' });
    }

    if (shareToken.expires_at && new Date(shareToken.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Share link expired' });
    }

    return res.json({
      song: shareToken.songs,
      requiresAccessCode: !!shareToken.access_code,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/share/:token/access - Verify access code
router.post('/share/:token/access', async (req: AuthRequest, res: Response) => {
  const { access_code } = req.body;

  try {
    const { data: shareToken, error } = await supabase
      .from('share_tokens')
      .select('*, songs(*)')
      .eq('token', req.params.token)
      .single();

    if (error || !shareToken) {
      return res.status(404).json({ error: 'Invalid share link' });
    }

    if (shareToken.access_code && shareToken.access_code !== access_code) {
      return res.status(403).json({ error: 'Invalid access code' });
    }

    return res.json({ song: shareToken.songs });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/songs - Create new song
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { title, content, artist, original_key, tempo, genre, is_public } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  try {
    const { data, error } = await supabase
      .from('songs')
      .insert({
        title,
        content,
        artist,
        original_key,
        tempo,
        genre,
        is_public: is_public || false,
        owner_id: req.userId,
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// =============================================
// NOTIFICATIONS ROUTES (before /:id to avoid conflict)
// =============================================

// GET /api/songs/notifications - Get current user's notifications
router.get('/notifications', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('Fetching notifications for user:', req.userId);

  try {
    const supabaseAuth = getSupabaseWithAuth(req);
    
    const { data, error } = await supabaseAuth
      .from('notifications')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(50);

    console.log('Notifications data:', data, 'error:', error);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json(data || []);
  } catch (error: any) {
    console.error('Error fetching notifications:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/songs/notifications/unread-count - Get unread notification count
router.get('/notifications/unread-count', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabaseAuth = getSupabaseWithAuth(req);
    
    const { count, error } = await supabaseAuth
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.userId)
      .eq('is_read', false);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ count: count || 0 });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/songs/notifications/:id/read - Mark notification as read
router.post('/notifications/:id/read', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabaseAuth = getSupabaseWithAuth(req);
    
    const { error } = await supabaseAuth
      .from('notifications')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('user_id', req.userId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/songs/notifications/read-all - Mark all notifications as read
router.post('/notifications/read-all', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabaseAuth = getSupabaseWithAuth(req);
    
    const { error } = await supabaseAuth
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.userId)
      .eq('is_read', false);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// =============================================
// PARAMETERIZED ROUTES /:id (come after specific routes)
// =============================================

// GET /api/songs/:id - Get song by ID
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('songs')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      return res.status(404).json({ error: 'Song not found' });
    }

    if (data.owner_id !== req.userId && !data.is_public) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/songs/:id/public - Get public song (no auth required)
router.get('/:id/public', async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('songs')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Song not found' });
    }

    if (!data.is_public) {
      return res.status(404).json({ error: 'Song not found' });
    }

    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', data.owner_id)
      .single();

    return res.json({
      ...data,
      owner_username: ownerProfile?.username || 'Unknown',
      owner_avatar: ownerProfile?.avatar_url || null,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/songs/:id/fork - Create a copy of a song
router.post('/:id/fork', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { title, content, original_key } = req.body;

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: originalSong, error: fetchError } = await supabase
      .from('songs')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !originalSong) {
      return res.status(404).json({ error: 'Song not found' });
    }

    if (originalSong.owner_id !== req.userId && !originalSong.is_public) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data, error } = await supabase
      .from('songs')
      .insert({
        title: title || `${originalSong.title} (Copia)`,
        content: content || originalSong.content,
        artist: originalSong.artist,
        original_key: original_key || originalSong.original_key,
        tempo: originalSong.tempo,
        genre: originalSong.genre,
        is_public: false,
        owner_id: req.userId,
        parent_song_id: originalSong.id,
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/songs/:id/public/fork - Fork a public song
router.post('/:id/public/fork', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: originalSong, error: fetchError } = await supabase
      .from('songs')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !originalSong) {
      return res.status(404).json({ error: 'Song not found' });
    }

    if (!originalSong.is_public) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data, error } = await supabase
      .from('songs')
      .insert({
        title: `${originalSong.title} (Copia)`,
        content: originalSong.content,
        artist: originalSong.artist,
        original_key: originalSong.original_key,
        tempo: originalSong.tempo,
        genre: originalSong.genre,
        is_public: false,
        owner_id: req.userId,
        parent_song_id: originalSong.id,
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// PUT /api/songs/:id - Update song
router.put('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { title, content, artist, original_key, tempo, genre, is_public } = req.body;

  try {
    const { data: existingSong, error: fetchError } = await supabase
      .from('songs')
      .select('owner_id')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existingSong) {
      return res.status(404).json({ error: 'Song not found' });
    }

    if (existingSong.owner_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data, error } = await supabase
      .from('songs')
      .update({
        title,
        content,
        artist,
        original_key,
        tempo,
        genre,
        is_public,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/songs/:id - Delete song
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { data: existingSong, error: fetchError } = await supabase
      .from('songs')
      .select('owner_id')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !existingSong) {
      return res.status(404).json({ error: 'Song not found' });
    }

    if (existingSong.owner_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { error } = await supabase.from('songs').delete().eq('id', req.params.id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ message: 'Song deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// =============================================
// SHARE TOKEN ENDPOINTS
// =============================================

// POST /api/songs/:id/share - Create share token
router.post('/:id/share', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { access_code, expires_at } = req.body;
  const supabaseAuth = getSupabaseWithAuth(req);

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: song, error: songError } = await supabaseAuth
      .from('songs')
      .select('owner_id')
      .eq('id', req.params.id)
      .single();

    if (songError || !song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    if (song.owner_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const token = randomBytes(32).toString('hex');

    const { data, error } = await supabaseAuth
      .from('share_tokens')
      .insert({
        song_id: req.params.id,
        token,
        access_code: access_code || null,
        expires_at: expires_at || null,
        created_by: req.userId,
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/songs/:id/share - Get share tokens for a song
router.get('/:id/share', authMiddleware, async (req: AuthRequest, res: Response) => {
  const supabaseAuth = getSupabaseWithAuth(req);
  
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: song, error: songError } = await supabaseAuth
      .from('songs')
      .select('owner_id')
      .eq('id', req.params.id)
      .single();

    if (songError || !song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    if (song.owner_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data, error } = await supabaseAuth
      .from('share_tokens')
      .select('*')
      .eq('song_id', req.params.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json(data || []);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/songs/:id/share/:tokenId - Delete share token
router.delete('/:id/share/:tokenId', authMiddleware, async (req: AuthRequest, res: Response) => {
  const supabaseAuth = getSupabaseWithAuth(req);
  
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: song, error: songError } = await supabaseAuth
      .from('songs')
      .select('owner_id')
      .eq('id', req.params.id)
      .single();

    if (songError || !song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    if (song.owner_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { error } = await supabaseAuth
      .from('share_tokens')
      .delete()
      .eq('id', req.params.tokenId)
      .eq('song_id', req.params.id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ message: 'Share token deleted' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// =============================================
// COLLABORATORS ENDPOINTS
// =============================================

// GET /api/songs/:id/collaborators - List collaborators
router.get('/:id/collaborators', authMiddleware, async (req: AuthRequest, res: Response) => {
  const supabaseAuth = getSupabaseWithAuth(req);
  
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: song, error: songError } = await supabaseAuth
      .from('songs')
      .select('owner_id')
      .eq('id', req.params.id)
      .single();

    if (songError || !song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    if (song.owner_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data: collaborators, error } = await supabaseAuth
      .from('collaborators')
      .select('*')
      .eq('song_id', req.params.id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Fetch profiles separately
    const collaboratorsWithProfiles = await Promise.all(
      (collaborators || []).map(async (collab) => {
        const { data: profile } = await supabaseAuth
          .from('profiles')
          .select('username, avatar_url')
          .eq('id', collab.user_id)
          .single();
        return { ...collab, profiles: profile };
      })
    );

    return res.json(collaboratorsWithProfiles);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/songs/:id/collaborators - Add collaborator
router.post('/:id/collaborators', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { user_id, permission = 'read', email } = req.body;
  const supabaseAuth = getSupabaseWithAuth(req);

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const validPermissions = ['read', 'comment', 'edit', 'admin'];
  if (!validPermissions.includes(permission)) {
    return res.status(400).json({ error: 'Invalid permission' });
  }

  try {
    const { data: song, error: songError } = await supabaseAuth
      .from('songs')
      .select('owner_id')
      .eq('id', req.params.id)
      .single();

    if (songError || !song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    if (song.owner_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let collaboratorUserId = user_id;

    if (email && !user_id) {
      // Search by username in profiles table
      const { data: profile, error: profileError } = await supabaseAuth
        .from('profiles')
        .select('id, username')
        .ilike('username', `%${email}%`)
        .limit(10);

      console.log('Search profiles:', profile, profileError);

      if (!profile || profile.length === 0) {
        return res.status(400).json({ 
          error: 'Usuario no encontrado. Busca por username en la tabla profiles.' 
        });
      }

      // If exact match
      const exactMatch = profile.find(p => p.username.toLowerCase() === email.toLowerCase());
      if (exactMatch) {
        collaboratorUserId = exactMatch.id;
      } else {
        // Return suggestions
        const suggestions = profile.map(p => p.username).join(', ');
        return res.status(400).json({ 
          error: `Usuario no encontrado. ¿Quisiste decir alguno de estos?: ${suggestions}` 
        });
      }
    }

    if (!collaboratorUserId) {
      return res.status(400).json({ error: 'Se requiere user_id o email' });
    }

    if (collaboratorUserId === song.owner_id) {
      return res.status(400).json({ error: 'No puedes agregar al propietario como colaborador' });
    }

    const { data, error } = await supabaseAuth
      .from('collaborators')
      .upsert({
        song_id: req.params.id,
        user_id: collaboratorUserId,
        permission,
      }, {
        onConflict: 'song_id,user_id',
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Get song title for notification
    const { data: songData } = await supabaseAuth
      .from('songs')
      .select('title')
      .eq('id', req.params.id)
      .single();

    // Create notification for the collaborator using RPC (bypasses RLS)
    try {
      await supabaseAuth
        .rpc('create_notification', {
          p_user_id: collaboratorUserId,
          p_type: 'collaborator_added',
          p_title: 'Agregado como colaborador',
          p_message: `Fuiste agregado como colaborador en "${songData?.title || 'una canción'}"`,
          p_link: `/songs/${req.params.id}/view`,
        });
    } catch (notifError) {
      console.error('Error creating collaborator notification:', notifError);
    }

    return res.status(201).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/songs/:id/collaborators/:userId - Remove collaborator
router.delete('/:id/collaborators/:userId', authMiddleware, async (req: AuthRequest, res: Response) => {
  const supabaseAuth = getSupabaseWithAuth(req);
  
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: song, error: songError } = await supabaseAuth
      .from('songs')
      .select('owner_id')
      .eq('id', req.params.id)
      .single();

    if (songError || !song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    if (song.owner_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { error } = await supabaseAuth
      .from('collaborators')
      .delete()
      .eq('song_id', req.params.id)
      .eq('user_id', req.params.userId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ message: 'Collaborator removed' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// =============================================
// COMMENTS ENDPOINTS
// =============================================

// GET /api/songs/:id/comments - Get comments for a song
router.get('/:id/comments', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabaseAuth = getSupabaseWithAuth(req);
    
    const { data: song, error: songError } = await supabaseAuth
      .from('songs')
      .select('owner_id, is_public')
      .eq('id', req.params.id)
      .single();

    if (songError || !song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    const { data: comments, error } = await supabaseAuth
      .from('comments')
      .select('*')
      .eq('song_id', req.params.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const commentsWithProfiles = await Promise.all(
      (comments || []).map(async (comment) => {
        const { data: profile } = await supabaseAuth
          .from('profiles')
          .select('username, avatar_url')
          .eq('id', comment.user_id)
          .single();
        return { ...comment, profiles: profile };
      })
    );

    return res.json(commentsWithProfiles);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/songs/:id/comments - Add comment to a song
router.post('/:id/comments', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { content } = req.body;

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Comment content is required' });
  }

  try {
    const supabaseAuth = getSupabaseWithAuth(req);
    
    // Get song owner
    const { data: song } = await supabaseAuth
      .from('songs')
      .select('id, title, owner_id')
      .eq('id', req.params.id)
      .single();

    if (!song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    const { data: comment, error } = await supabaseAuth
      .from('comments')
      .insert({
        song_id: req.params.id,
        user_id: req.userId,
        content: content.trim(),
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const { data: profile } = await supabaseAuth
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', req.userId)
      .single();

    // Create notification for song owner (if not own comment)
    if (song.owner_id !== req.userId) {
      try {
        // Use RPC to create notification (bypasses RLS)
        const { data: notifData, error: notifError } = await supabaseAuth
          .rpc('create_notification', {
            p_user_id: song.owner_id,
            p_type: 'comment',
            p_title: 'Nuevo comentario',
            p_message: `${profile?.username || 'Alguien'} comento en "${song.title}"`,
            p_link: `/songs/${song.id}/view`,
          });
        
        console.log('Notification created:', notifData, notifError);
      } catch (notifError) {
        console.error('Error creating notification:', notifError);
      }
    }

    return res.status(201).json({ ...comment, profiles: profile });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/songs/:id/comments/:commentId - Delete a comment
router.delete('/:id/comments/:commentId', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabaseAuth = getSupabaseWithAuth(req);
    
    const { data: comment, error: fetchError } = await supabaseAuth
      .from('comments')
      .select('user_id')
      .eq('id', req.params.commentId)
      .single();

    if (fetchError || !comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    if (comment.user_id !== req.userId) {
      return res.status(403).json({ error: 'Cannot delete this comment' });
    }

    const { error } = await supabaseAuth
      .from('comments')
      .delete()
      .eq('id', req.params.commentId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ message: 'Comment deleted' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// =============================================
// ACTIVITY LOG ENDPOINTS
// =============================================

// GET /api/songs/:id/activity - Get activity log for a song
router.get('/:id/activity', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabaseAuth = getSupabaseWithAuth(req);
    
    const { data: song, error: songError } = await supabaseAuth
      .from('songs')
      .select('owner_id')
      .eq('id', req.params.id)
      .single();

    if (songError || !song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    const isOwner = song.owner_id === req.userId;
    
    const { data: collab } = await supabaseAuth
      .from('collaborators')
      .select('permission')
      .eq('song_id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    const canView = isOwner || (collab && ['edit', 'admin'].includes(collab.permission));

    if (!canView) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data, error } = await supabaseAuth
      .from('activity_log')
      .select('*, profiles(username)')
      .eq('song_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json(data || []);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/songs/:id/activity - Log activity
router.post('/:id/activity', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { action, details } = req.body;

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabaseAuth = getSupabaseWithAuth(req);
    
    const { data, error } = await supabaseAuth
      .from('activity_log')
      .insert({
        song_id: req.params.id,
        user_id: req.userId,
        action,
        details: details || null,
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// =============================================
// STATISTICS ENDPOINTS
// =============================================

// POST /api/songs/:id/view - Increment view count
router.post('/:id/view', async (req: AuthRequest, res: Response) => {
  try {
    const { data: song, error: songError } = await supabase
      .from('songs')
      .select('view_count')
      .eq('id', req.params.id)
      .single();

    if (songError || !song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    const newCount = (song.view_count || 0) + 1;

    await supabase
      .from('songs')
      .update({ view_count: newCount })
      .eq('id', req.params.id);

    return res.json({ success: true, view_count: newCount });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/songs/:id/stats - Get song statistics
router.get('/:id/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabaseAuth = getSupabaseWithAuth(req);
    
    const { data: song, error: songError } = await supabaseAuth
      .from('songs')
      .select('owner_id, view_count, share_count')
      .eq('id', req.params.id)
      .single();

    if (songError || !song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    if (song.owner_id !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data: commentsCount } = await supabase
      .from('comments')
      .select('id', { count: 'exact', head: true })
      .eq('song_id', req.params.id);

    const { data: collaboratorsCount } = await supabase
      .from('collaborators')
      .select('id', { count: 'exact', head: true })
      .eq('song_id', req.params.id);

    return res.json({
      view_count: song.view_count || 0,
      share_count: song.share_count || 0,
      comments_count: commentsCount || 0,
      collaborators_count: collaboratorsCount || 0,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Helper function to create notification
export async function createNotification(
  supabaseAuth: any,
  userId: string,
  type: string,
  title: string,
  message: string,
  link?: string
) {
  const { data, error } = await supabaseAuth
    .from('notifications')
    .insert({
      user_id: userId,
      type,
      title,
      message,
      link,
    })
    .select()
    .single();

  return { data, error };
}

export default router;
