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

// POST /api/songs/:id/fork - Create a copy of a song
router.post('/:id/fork', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { title, content, original_key } = req.body;

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get the original song
    const { data: originalSong, error: fetchError } = await supabase
      .from('songs')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (fetchError || !originalSong) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Check access (owner or public)
    if (originalSong.owner_id !== req.userId && !originalSong.is_public) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Create the fork
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

// =============================================
// PUBLIC ENDPOINTS (no auth required)
// =============================================

// GET /api/songs/public - List public songs (for exploration)
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

    // Get owner profile
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

// GET /api/songs/:id/public/fork - Fork a public song (auth required)
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

    const { data, error } = await supabaseAuth
      .from('collaborators')
      .select('*, profiles(username, avatar_url)')
      .eq('song_id', req.params.id);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json(data || []);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/songs/:id/collaborators - Add collaborator
router.post('/:id/collaborators', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { user_id, permission = 'read' } = req.body;
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

    const { data, error } = await supabaseAuth
      .from('collaborators')
      .upsert({
        song_id: req.params.id,
        user_id,
        permission,
      }, {
        onConflict: 'song_id,user_id',
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
// SHARED SONGS ENDPOINT
// =============================================

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

    const { data, error } = await supabaseAuth
      .from('comments')
      .select('*, profiles(username, avatar_url)')
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
    
    const { data, error } = await supabaseAuth
      .from('comments')
      .insert({
        song_id: req.params.id,
        user_id: req.userId,
        content: content.trim(),
      })
      .select('*, profiles(username, avatar_url)')
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/comments/:id - Delete a comment
router.delete('/comments/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const supabaseAuth = getSupabaseWithAuth(req);
    
    const { data: comment, error: fetchError } = await supabaseAuth
      .from('comments')
      .select('user_id')
      .eq('id', req.params.id)
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
      .eq('id', req.params.id);

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

export default router;
