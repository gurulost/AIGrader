import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { configureAuth } from '../../server/auth';

// Mock dependencies
vi.mock('express-session', () => {
  return {
    default: vi.fn(() => (req: any, res: any, next: any) => next())
  };
});

vi.mock('connect-pg-simple', () => {
  return {
    default: vi.fn().mockImplementation(() => {
      return function PgStore() {
        return {};
      };
    })
  };
});

vi.mock('passport', () => {
  return {
    default: {
      initialize: vi.fn(() => (req: any, res: any, next: any) => next()),
      session: vi.fn(() => (req: any, res: any, next: any) => next()),
      use: vi.fn(),
      authenticate: vi.fn().mockImplementation(() => (req: any, res: any, next: any) => {
        if (req.headers['x-test-auth-fail'] === 'true') {
          return res.status(401).json({ message: 'Invalid credentials' });
        }
        req.user = { id: 1, username: 'testuser', role: 'student' };
        next();
      }),
      serializeUser: vi.fn(),
      deserializeUser: vi.fn()
    }
  };
});

vi.mock('csrf-csrf', () => {
  let storedToken: string | null = null;
  return {
    doubleCsrf: vi.fn().mockImplementation(() => ({
      generateCsrfToken: vi.fn((req: any, res: any) => {
        storedToken = 'mock-csrf-token';
        return storedToken;
      }),
      doubleCsrfProtection: vi.fn((req: any, res: any, next: any) => {
        if (req.headers['x-csrf-token'] === storedToken) {
          return next();
        }
        return res.status(403).json({ message: 'CSRF token validation failed' });
      })
    }))
  };
});

vi.mock('../../server/storage', () => {
  return {
    storage: {
      getUserByUsername: vi.fn().mockImplementation(async (username) => {
        if (username === 'existing') {
          return { id: 1, username: 'existing', password: 'hashed' };
        }
        return undefined;
      }),
      getUserByEmail: vi.fn().mockResolvedValue(undefined),
      getUser: vi.fn().mockResolvedValue({ id: 1, username: 'testuser' }),
      createUser: vi.fn().mockImplementation(async (user) => ({ id: 2, ...user })),
      sessionStore: {}
    }
  };
});

vi.mock('../../server/db', () => {
  return {
    pool: {}
  };
});

vi.mock('bcrypt', () => {
  return {
    default: {
      compare: vi.fn().mockResolvedValue(true),
      hash: vi.fn().mockResolvedValue('hashed-password')
    }
  };
});

// Mock rate limiters
let loginRateLimited = false;
let registerRateLimited = false;
let csrfRateLimited = false;

vi.mock('../../server/middleware/rate-limiter', () => {
  return {
    authRateLimiter: (req: any, res: any, next: any) => {
      if (req.path === '/api/auth/login' && loginRateLimited) {
        return res.status(429).json({
          status: 'error',
          message: 'Too many login attempts, please try again later.'
        });
      }
      if (req.path === '/api/auth/register' && registerRateLimited) {
        return res.status(429).json({
          status: 'error',
          message: 'Too many registration attempts, please try again later.'
        });
      }
      next();
    },
    csrfRateLimiter: (req: any, res: any, next: any) => {
      if (csrfRateLimited) {
        return res.status(429).json({
          status: 'error',
          message: 'Too many requests for CSRF token, please try again later.'
        });
      }
      next();
    },
    defaultRateLimiter: (req: any, res: any, next: any) => next(),
    submissionRateLimiter: (req: any, res: any, next: any) => next()
  };
});

describe('Auth Endpoints Rate Limiting Integration Tests', () => {
  let app: Express;
  
  beforeEach(() => {
    // Reset rate limit flags
    loginRateLimited = false;
    registerRateLimited = false;
    csrfRateLimited = false;
    
    // Setup environment
    process.env.NODE_ENV = 'test';
    process.env.SESSION_SECRET = 'a'.repeat(32);
    process.env.CSRF_SECRET = 'b'.repeat(32);
    
    // Create Express app
    app = express();
    app.use(express.json());

    // Configure auth routes
    configureAuth(app);

    // Simple protected route for CSRF validation
    app.post('/api/protected', (req: Request, res: Response) => {
      res.json({ ok: true });
    });
  });
  
  afterEach(() => {
    vi.resetAllMocks();
  });
  
  it('should return 429 when login endpoint is rate limited', async () => {
    // Enable login rate limiting
    loginRateLimited = true;
    
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'testuser',
        password: 'password123'
      });
    
    expect(response.status).toBe(429);
    expect(response.body).toHaveProperty('message', 'Too many login attempts, please try again later.');
  });
  
  it('should return 429 when register endpoint is rate limited', async () => {
    // Enable register rate limiting
    registerRateLimited = true;
    
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'newuser',
        email: 'new@example.com',
        name: 'New User',
        password: 'Password123!'
      });
    
    expect(response.status).toBe(429);
    expect(response.body).toHaveProperty('message', 'Too many registration attempts, please try again later.');
  });
  
  it('should return 429 when CSRF token endpoint is rate limited', async () => {
    // Enable CSRF token rate limiting
    csrfRateLimited = true;
    
    const response = await request(app)
      .get('/api/csrf-token');
    
    expect(response.status).toBe(429);
    expect(response.body).toHaveProperty('message', 'Too many requests for CSRF token, please try again later.');
  });

  it('should allow protected requests with a valid CSRF token', async () => {
    const agent = request.agent(app);
    const tokenRes = await agent.get('/api/csrf-token');

    expect(tokenRes.status).toBe(200);
    const token = tokenRes.body.csrfToken;

    const response = await agent
      .post('/api/protected')
      .set('x-csrf-token', token)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('ok', true);
  });
  
  it('should allow login when not rate limited', async () => {
    // Disable login rate limiting
    loginRateLimited = false;
    
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'testuser',
        password: 'password123'
      });
    
    // Should pass rate limiting and proceed to authentication
    expect(response.status).not.toBe(429);
  });
  
  it('should allow registration when not rate limited', async () => {
    // Disable register rate limiting
    registerRateLimited = false;
    
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        username: 'newuser',
        email: 'new@example.com',
        name: 'New User',
        password: 'Password123!'
      });
    
    // Should pass rate limiting
    expect(response.status).not.toBe(429);
  });
});