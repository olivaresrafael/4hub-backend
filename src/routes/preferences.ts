import { Router, Response } from 'express';
import { supabase } from '../services/supabase';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// GET /api/preferences/:songId - Get user preference for a song
router.get('/:songId', async (req: AuthRequest, res: Response) => {
  const { songId } = req.params;

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data, error } = await supabase
      .from('user_song_preferences')
      .select('*')
      .eq('user_id', req.userId)
      .eq('song_id', songId)
      .maybeSingle();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json(data || { preferred_key: null, use_flats: false });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// PUT /api/preferences/:songId - Save/update preference
router.put('/:songId', async (req: AuthRequest, res: Response) => {
  const { songId } = req.params;
  const { preferred_key, use_flats } = req.body;

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Validate preferred_key if provided
  const validKeys = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
  if (preferred_key && !validKeys.includes(preferred_key)) {
    return res.status(400).json({ error: 'Invalid key' });
  }

  try {
    // Use upsert to create or update
    const { data, error } = await supabase
      .from('user_song_preferences')
      .upsert({
        user_id: req.userId,
        song_id: songId,
        preferred_key: preferred_key || null,
        use_flats: use_flats || false,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,song_id',
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// DELETE /api/preferences/:songId - Delete preference
router.delete('/:songId', async (req: AuthRequest, res: Response) => {
  const { songId } = req.params;

  if (!req.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { error } = await supabase
      .from('user_song_preferences')
      .delete()
      .eq('user_id', req.userId)
      .eq('song_id', songId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    return res.json({ message: 'Preference deleted' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

export default router;
