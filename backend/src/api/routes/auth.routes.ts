import { Router, Request, Response } from 'express';
import { UserRepository, UserSecurity } from '../../models/User.model.js';
import { JwtService } from '../../core/jwt.js';
import { requireAuth } from '../../core/auth.middleware.js';
import { createRateLimiter } from '../../core/security.middleware.js';

const router = Router();

// Strict brute-force protection on authentication attempts
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 15,
  prefix: 'auth',
  message: 'Too many authentication attempts. Please try again after 15 minutes.',
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/register - Create account
router.post('/register', authRateLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const existing = await UserRepository.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const user = await UserRepository.create(email, password);
    const token = JwtService.sign({
      userId: user.id,
      email: user.email,
    });

    return res.status(201).json({
      status: 'success',
      token,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  } catch (err: any) {
    console.error('[Auth Register Error]:', err);
    return res.status(500).json({ error: err.message || 'Internal server error creating account' });
  }
});

// POST /api/auth/login - Sign in
router.post('/login', authRateLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await UserRepository.findByEmail(email);
    if (!user) {
      // Use generic error message to prevent account enumeration
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await UserSecurity.verifyPassword(password, user.passwordHash, user.salt);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = JwtService.sign({
      userId: user.id,
      email: user.email,
    });

    return res.json({
      status: 'success',
      token,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
      },
    });
  } catch (err: any) {
    console.error('[Auth Login Error]:', err);
    return res.status(500).json({ error: 'Internal server error during login' });
  }
});

// GET /api/auth/me - Current user profile
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await UserRepository.findById(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

export default router;

