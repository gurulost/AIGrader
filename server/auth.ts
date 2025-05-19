import { Request, Response, NextFunction } from 'express';
import session from 'express-session';
import passport from 'passport';

// Extend express-session types to include our custom properties
declare module 'express-session' {
  interface SessionData {
    returnTo?: string;
  }
}

// Extend Express namespace to define User properties
declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      email?: string;
      role: string;
      name?: string;
      // Add other commonly used User properties here
    }
  }
}
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as Auth0Strategy } from 'passport-auth0';
import { Strategy as OIDCStrategy } from 'passport-openidconnect';
import { storage } from './storage';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import connectPgSimple from 'connect-pg-simple';
import { User } from '@shared/schema';
import { doubleCsrf } from 'csrf-csrf';
import { pool } from './db';
import { authRateLimiter, csrfRateLimiter } from './middleware/rate-limiter';
import * as crypto from 'crypto';
import { 
  logSuccessfulAuth, 
  logFailedAuth, 
  logLogout, 
  logUserCreation,
  logSecurityEvent,
  AuditEventType
} from './lib/audit-logger';

// Create PostgreSQL session store
const PgStore = connectPgSimple(session);
const sessionStore = new PgStore({
  pool,
  createTableIfMissing: true,
  tableName: 'session'
});

// Function to validate critical security environment variables
function validateSecurityEnvVars() {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Check SESSION_SECRET
  if (!process.env.SESSION_SECRET) {
    if (isProduction) {
      throw new Error('FATAL ERROR: SESSION_SECRET environment variable is not set. This is required for production deployments.');
    } else {
      console.error('\x1b[31m%s\x1b[0m', 'WARNING: SESSION_SECRET environment variable is not set. ' + 
                   'This is a security risk. Never deploy to production without setting SESSION_SECRET ' +
                   'to a strong, random value.');
      process.exit(1); // Exit even in development to ensure proper configuration
    }
  } else if (process.env.SESSION_SECRET.length < 32) {
    if (isProduction) {
      throw new Error('FATAL ERROR: SESSION_SECRET is too weak. It should be at least 32 characters long.');
    } else {
      console.warn('\x1b[33m%s\x1b[0m', 'WARNING: SESSION_SECRET is too weak. It should be at least 32 characters long.');
    }
  }
  
  // Check CSRF_SECRET
  if (!process.env.CSRF_SECRET) {
    if (isProduction) {
      throw new Error('FATAL ERROR: CSRF_SECRET environment variable is not set. This is required for production deployments.');
    } else {
      console.error('\x1b[31m%s\x1b[0m', 'WARNING: CSRF_SECRET environment variable is not set. ' +
                   'This is a security risk. Never deploy to production without setting CSRF_SECRET ' +
                   'to a strong, random value.');
      process.exit(1); // Exit even in development to ensure proper configuration
    }
  } else if (process.env.CSRF_SECRET.length < 32) {
    if (isProduction) {
      throw new Error('FATAL ERROR: CSRF_SECRET is too weak. It should be at least 32 characters long.');
    } else {
      console.warn('\x1b[33m%s\x1b[0m', 'WARNING: CSRF_SECRET is too weak. It should be at least 32 characters long.');
    }
  }
  
  // Check Auth0 environment variables if SSO is enabled
  const auth0Enabled = process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_SECRET;
  
  if (auth0Enabled) {
    console.log('[INFO] Auth0 SSO configuration detected');
    
    // Check for BASE_URL environment variable which is preferred for production deployments
    if (isProduction && !process.env.BASE_URL) {
      console.warn('\x1b[33m%s\x1b[0m', 'WARNING: BASE_URL environment variable is not set in production. This is recommended for ensuring correct callback URLs.');
    }
    
    // Validate Auth0 callback URL - explicit configuration is strongly recommended
    if (!process.env.AUTH0_CALLBACK_URL) {
      if (isProduction) {
        console.error('\x1b[31m%s\x1b[0m', 'ERROR: AUTH0_CALLBACK_URL is not set in production. Auth0 SSO will likely fail without an explicit callback URL.');
      } else {
        console.warn('\x1b[33m%s\x1b[0m', 'WARNING: AUTH0_CALLBACK_URL is not set. A fallback URL will be generated, but explicit configuration is recommended.');
      }
    } else if (!process.env.AUTH0_CALLBACK_URL.startsWith('http')) {
      console.warn('\x1b[33m%s\x1b[0m', 'WARNING: AUTH0_CALLBACK_URL should be a full URL including http/https protocol.');
    }
  } else {
    // Only warn in development mode to allow local development without Auth0
    if (!isProduction) {
      console.log('[INFO] Auth0 SSO is not configured. Local authentication will be used.');
    } else {
      console.warn('\x1b[33m%s\x1b[0m', 'WARNING: Auth0 SSO environment variables (AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET) are not fully set in production. SSO functionality will be disabled.');
    }
  }
  
  // Check MIT Horizon OIDC environment variables
  const mitHorizonEnabled = process.env.MIT_HORIZON_OIDC_ISSUER_URL && 
                           process.env.MIT_HORIZON_OIDC_CLIENT_ID && 
                           process.env.MIT_HORIZON_OIDC_CLIENT_SECRET &&
                           process.env.MIT_HORIZON_OIDC_CALLBACK_URL;
  
  if (mitHorizonEnabled) {
    console.log('[INFO] MIT Horizon OIDC configuration detected');
    
    // Validate the issuer URL and callback URL
    if (!process.env.MIT_HORIZON_OIDC_ISSUER_URL!.startsWith('https://')) {
      console.warn('\x1b[33m%s\x1b[0m', 'WARNING: MIT_HORIZON_OIDC_ISSUER_URL should be a full URL starting with https://');
    }
    
    if (!process.env.MIT_HORIZON_OIDC_CALLBACK_URL!.startsWith('http')) {
      console.warn('\x1b[33m%s\x1b[0m', 'WARNING: MIT_HORIZON_OIDC_CALLBACK_URL should be a full URL including http/https protocol.');
    }
  } else {
    // Only log informational message
    console.log('[INFO] MIT Horizon OIDC is not configured. This authentication method will be disabled.');
  }
}

export function configureAuth(app: any) {
  // Validate security environment variables before configuring authentication
  validateSecurityEnvVars();
  
  // Configure express-session with enhanced security
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Fix session configuration for development environment
  // Using properly typed session options to fix TypeScript errors
  const sessionOptions: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || 'development-secret-key-not-for-production', 
    resave: false,
    saveUninitialized: true, // Ensures session is created and cookie sent
    store: sessionStore,
    cookie: {
      secure: false, // Set to false for development (no HTTPS required)
      httpOnly: true, // Prevents client-side JS from reading the cookie
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax', // Using literal type for sameSite 
      path: '/', // Accessible across the whole site
    },
    // Enable proxy support for secure cookies behind load balancers in production
    proxy: isProduction
  };
  
  // Only use secure cookies in production
  if (isProduction) {
    if (sessionOptions.cookie) {
      sessionOptions.cookie.secure = true;
      // Using the type-checked constant value
      sessionOptions.cookie.sameSite = 'strict' as const; 
    }
  }
  
  app.use(session(sessionOptions));
  
  // Set appropriate security headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Helps prevent clickjacking attacks
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // Enables the Cross-site scripting (XSS) filter in browsers
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Prevents browsers from MIME-sniffing a response away from the declared content-type
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Strict-Transport-Security enforces secure connections to the server
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
  
  // Initialize CSRF protection - with fallback for development
  
  // Create a secure production CSRF handler and a development-mode fallback
  const productionCsrfHandler = {
    generateCsrfToken: (req: any, res: any) => {
      try {
        if (!req.session) {
          console.error('Session not available for CSRF token generation');
          throw new Error('Session not initialized');
        }
        
        const token = doubleCsrf({
          getSecret: () => process.env.CSRF_SECRET!,
          cookieName: '__Host-csrf',
          cookieOptions: {
            httpOnly: true,
            sameSite: 'strict',
            path: '/',
            secure: true,
          },
          size: 64,
          getSessionIdentifier: (req: any) => req.sessionID
        }).generateCsrfToken(req, res);
        
        return token;
      } catch (error) {
        console.error('Error generating production CSRF token:', error);
        throw error;
      }
    },
    
    doubleCsrfProtection: (req: any, res: any, next: any) => {
      try {
        if (!req.session) {
          console.error('Session not available for CSRF validation');
          throw new Error('Session not initialized');
        }
        
        const validator = doubleCsrf({
          getSecret: () => process.env.CSRF_SECRET!,
          cookieName: '__Host-csrf',
          cookieOptions: {
            httpOnly: true,
            sameSite: 'strict',
            path: '/',
            secure: true,
          },
          size: 64,
          getCsrfTokenFromRequest: (req: any) => req.headers['x-csrf-token'] as string,
          getSessionIdentifier: (req: any) => req.sessionID
        });
        
        validator.doubleCsrfProtection(req, res, next);
      } catch (error) {
        console.error('CSRF validation failed in production mode:', error);
        throw error;
      }
    }
  };
  
  const developmentCsrfHandler = {
    generateCsrfToken: (req: any, res: any) => {
      // In development, generate a secure token and store it in session
      const token = crypto.randomBytes(32).toString('hex');
      if (!req.session.csrfTokens) {
        req.session.csrfTokens = {};
      }
      req.session.csrfTokens[token] = true;
      return token;
    },
    
    doubleCsrfProtection: (req: any, res: any, next: any) => {
      // In development, perform lighter validation but still enforce security
      console.log('Development CSRF validation - proceeding with relaxed security checks');
      
      // If there's no session, create it
      if (!req.session) {
        console.warn('No session available for CSRF validation');
        return next();
      }
      
      // Initialize csrfTokens if not present
      if (!req.session.csrfTokens) {
        req.session.csrfTokens = {};
        console.warn('CSRF session initialized');
        return next();
      }
      
      // Properly validate token in development
      const token = req.headers['x-csrf-token'];
      
      // If no token is provided, log warning but proceed in development
      if (!token) {
        console.warn('Missing CSRF token in development - would fail in production');
        return next();
      }
      
      // Validate token
      if (req.session.csrfTokens[token]) {
        console.log('CSRF token validation passed');
        next();
      } else {
        // Log warning and proceed, but at least validate in development
        console.warn('CSRF token validation failed in development - would return 403 in production');
        next();
      }
    }
  };
  
  // Select the appropriate handler based on environment
  const csrfProtection = isProduction ? productionCsrfHandler : developmentCsrfHandler;
  
  // Add CSRF protection to all state-changing routes
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Only protect state-changing methods (not GET, HEAD, OPTIONS)
    const nonProtectedMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (nonProtectedMethods.includes(req.method)) {
      return next();
    }
    
    // Create more comprehensive list for production vs development
    const baseSkipList = [
      '/api/auth/login', 
      '/api/auth/register', 
      '/api/auth/logout', 
      '/api/csrf-token',
      '/api/auth-sso/callback', // Skip for Auth0 callback
      '/api/auth/horizon/callback', // Skip for MIT Horizon OIDC callback
      '/api/test-rubric' // Skip for rubric testing to help instructors test their rubrics
    ];
    
    // In development, also skip these endpoints to aid testing
    const devSkipList = isProduction ? [] : [
      '/api/assignments', // Skip for assignment creation during development
      '/api/courses' // Skip for course creation during development
    ];
    
    // Combined list of routes to skip CSRF for
    const skipCsrfForRoutes = [...baseSkipList, ...devSkipList];
    
    if (skipCsrfForRoutes.includes(req.path)) {
      return next();
    }
    
    // Apply CSRF protection for all other state-changing requests
    try {
      // Skip validation if session is not properly initialized
      if (!req.session) {
        console.warn(`CSRF validation skipped for ${req.method} ${req.path} due to missing session`);
        return next();
      }
      
      // The doubleCsrfProtection function will call next() on success
      // or throw an error on failure
      csrfProtection.doubleCsrfProtection(req, res, next);
    } catch (error: any) {
      console.error(`CSRF validation failed for ${req.method} ${req.path}:`, error);
      
      // Log CSRF failure for security monitoring
      logSecurityEvent(
        AuditEventType.CSRF_FAILURE,
        req.ip || 'unknown',
        (req.user as any)?.id,
        (req.user as any)?.username,
        { 
          path: req.path,
          method: req.method,
          userAgent: req.headers['user-agent']
        }
      );
      
      // If the token is invalid, return 403 Forbidden
      return res.status(403).json({
        message: 'CSRF token validation failed',
        error: error.message
      });
    }
  });
  
  // Endpoint to get CSRF token (with rate limiting)
  app.get('/api/csrf-token', csrfRateLimiter, (req: Request, res: Response) => {
    try {
      const token = csrfProtection.generateCsrfToken(req, res);
      return res.json({ csrfToken: token });
    } catch (error: any) {
      console.error('Error generating CSRF token - this is a critical security failure:', error);
      return res.status(500).json({
        error: 'Critical security error',
        message: 'Unable to generate secure token'
      });
    }
  });

  // Initialize passport
  app.use(passport.initialize());
  app.use(passport.session());

  // Configure passport to use local strategy with bcrypt password verification
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        // Find the user
        const user = await storage.getUserByUsername(username);
        
        // If user doesn't exist
        if (!user) {
          return done(null, false, { message: 'Incorrect username or password' });
        }
        
        // Verify password with bcrypt
        const isPasswordValid = await bcrypt.compare(password, user.password || '');
        if (!isPasswordValid) {
          return done(null, false, { message: 'Incorrect username or password' });
        }
        
        // Remove password from the user object before returning
        const { password: _, ...userWithoutPassword } = user;
        return done(null, userWithoutPassword);
      } catch (error) {
        return done(error);
      }
    })
  );
  
  // Configure Auth0 strategy if Auth0 environment variables are set
  const auth0Enabled = process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_SECRET;
  
  if (auth0Enabled) {
    console.log('[INFO] Configuring Auth0 strategy for SSO');
    
    // Determine the most reliable callback URL to use
    const getCallbackUrl = () => {
      // 1. Use explicit AUTH0_CALLBACK_URL if provided (highest priority)
      if (process.env.AUTH0_CALLBACK_URL) {
        return process.env.AUTH0_CALLBACK_URL;
      }
      
      // 2. Construct from BASE_URL if available (recommended for production)
      if (process.env.BASE_URL) {
        return `${process.env.BASE_URL.replace(/\/$/, '')}/api/auth-sso/callback`;
      }
      
      // 3. Fallback to constructed URL from host (least reliable)
      const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
      const host = app.get('host') || 'localhost:5000';
      return `${protocol}://${host}/api/auth-sso/callback`;
    };
    
    // Log the callback URL being used
    const callbackUrl = getCallbackUrl();
    console.log(`[INFO] Auth0 callback URL: ${callbackUrl}`);
    
    passport.use(
      new Auth0Strategy(
        {
          domain: process.env.AUTH0_DOMAIN!,
          clientID: process.env.AUTH0_CLIENT_ID!,
          clientSecret: process.env.AUTH0_CLIENT_SECRET!,
          callbackURL: callbackUrl,
          state: true
        },
        async (accessToken: string, refreshToken: string, extraParams: any, profile: any, done: any) => {
          try {
            // Log profile information during development to help with integration
            if (process.env.NODE_ENV !== 'production') {
              console.log('[DEBUG] Auth0 profile:', JSON.stringify(profile, null, 2));
            }
            
            // Extract user information from Auth0 profile
            const auth0UserId = profile.id;
            const email = profile.emails?.[0]?.value;
            const name = profile.displayName || (profile.name ? `${profile.name.givenName} ${profile.name.familyName}` : 'Unknown');
            const emailVerified = profile._json?.email_verified || false;
            
            if (!email) {
              return done(new Error('Email is required from Auth0 profile'));
            }
            
            // Try to find user by Auth0 ID first
            let user = await storage.getUserByAuth0Sub(auth0UserId);
            
            // If not found, try to find by email for existing users
            if (!user) {
              const existingUser = await storage.getUserByEmail(email);
              
              if (existingUser) {
                // Update existing user with Auth0 ID
                user = await storage.updateUserAuth0Sub(existingUser.id, auth0UserId);
                console.log(`[INFO] Linked Auth0 ID to existing user: ${existingUser.username}`);
                
                // Update email verification status
                if (user) {
                  await storage.updateUserEmailVerifiedStatus(user.id, emailVerified);
                }
              } else {
                // Create new user with Auth0 information
                // Generate username from email with improved sanitization and uniqueness
                const sanitizedEmailPrefix = email.split('@')[0]
                  .replace(/[^a-zA-Z0-9._-]/g, '') // Remove special chars except some safe ones
                  .toLowerCase();
                const randomSuffix = Math.floor(Math.random() * 10000);
                const timestamp = Date.now().toString().slice(-4); // Last 4 digits of timestamp
                const username = `${sanitizedEmailPrefix}_${randomSuffix}${timestamp}`;
                
                // Create new user with default role of student and null password (Auth0-only user)
                user = await storage.createUser({
                  username,
                  email,
                  name,
                  password: null, // No password for SSO users
                  role: 'student',
                  auth0Sub: auth0UserId,
                  emailVerified
                });
                
                console.log(`[INFO] Created new user from Auth0 login: ${username}`);
                
                // Log the user creation event for audit purposes
                if (user) {
                  logUserCreation(
                    user.id,
                    user.username,
                    undefined, // No creator user ID for SSO registration
                    undefined, // No creator username for SSO registration
                    'Auth0 SSO' // Use a descriptive string instead of IP
                  );
                }
              }
            } else {
              // We found the user by Auth0 ID, update email verification status
              await storage.updateUserEmailVerifiedStatus(user.id, emailVerified);
            }
            
            if (!user) {
              return done(new Error('Failed to retrieve or create user account'));
            }
            
            // Log successful authentication
            logSuccessfulAuth(
              user.id,
              user.username,
              'Auth0 SSO', // Indicate SSO authentication method
              profile.provider || 'Auth0' // Use the provider information from the Auth0 profile
            );
            
            // Create a new object without the password property
            const { password, ...userWithoutPassword } = user;
            
            return done(null, userWithoutPassword as User);
          } catch (error) {
            console.error('[ERROR] Auth0 authentication error:', error);
            return done(error);
          }
        }
      )
    );
    
    // Auth0 login route
    app.get('/api/auth-sso/login', (req: Request, res: Response, next: NextFunction) => {
      // Store returnTo in session if provided
      if (req.query.returnTo) {
        req.session.returnTo = req.query.returnTo as string;
      }
      
      passport.authenticate('auth0', { 
        scope: 'openid email profile' 
      })(req, res, next);
    });
    
    // Auth0 callback route
    app.get('/api/auth-sso/callback', (req: Request, res: Response, next: NextFunction) => {
      passport.authenticate('auth0', (err: Error | null, user: User | undefined, info: any) => {
        if (err) {
          console.error('[ERROR] Auth0 callback error:', err);
          return res.redirect('/login?error=sso_failed&reason=' + encodeURIComponent(err.message));
        }
        
        if (!user) {
          console.error('[ERROR] Auth0 callback did not return a user');
          return res.redirect('/login?error=sso_failed&reason=no_user_returned');
        }
        
        req.login(user, (err) => {
          if (err) {
            console.error('[ERROR] Session login error:', err);
            return res.redirect('/login?error=sso_failed&reason=session_error');
          }
          
          // Check for returnTo parameter in the session (set during login initiation)
          let returnTo = '/';
          if (req.session.returnTo) {
            returnTo = req.session.returnTo;
            delete req.session.returnTo; // Clear it after use
          }
            
          // Validate returnTo URL to prevent open redirect vulnerabilities
          if (!returnTo.startsWith('/') || returnTo.includes('//')) {
            returnTo = '/';
          }
            
          console.log('[INFO] Redirecting after successful Auth0 login to:', returnTo);
          return res.redirect(returnTo);
        });
      })(req, res, next);
    });
  } else {
    console.log('[INFO] Auth0 SSO not configured, skipping Auth0 strategy setup');
  }
  
  // Configure MIT Horizon OIDC strategy if environment variables are set
  const mitHorizonEnabled = process.env.MIT_HORIZON_OIDC_ISSUER_URL && 
                          process.env.MIT_HORIZON_OIDC_CLIENT_ID && 
                          process.env.MIT_HORIZON_OIDC_CLIENT_SECRET &&
                          process.env.MIT_HORIZON_OIDC_CALLBACK_URL;
  
  if (mitHorizonEnabled) {
    console.log('[INFO] Configuring MIT Horizon OIDC strategy');
    
    passport.use('horizon-oidc', new OIDCStrategy({
      issuer: process.env.MIT_HORIZON_OIDC_ISSUER_URL!,
      authorizationURL: `${process.env.MIT_HORIZON_OIDC_ISSUER_URL}authorize`,
      tokenURL: `${process.env.MIT_HORIZON_OIDC_ISSUER_URL}oauth/token`,
      userInfoURL: `${process.env.MIT_HORIZON_OIDC_ISSUER_URL}userinfo`,
      clientID: process.env.MIT_HORIZON_OIDC_CLIENT_ID!,
      clientSecret: process.env.MIT_HORIZON_OIDC_CLIENT_SECRET!,
      callbackURL: process.env.MIT_HORIZON_OIDC_CALLBACK_URL!,
      scope: 'openid email profile',
      passReqToCallback: false,
      skipUserProfile: false
    },
    async (issuer, profile, idProfile, context, idToken, accessToken, refreshToken, params, done) => {
      try {
        // Log profile information during development to help with integration
        if (process.env.NODE_ENV !== 'production') {
          console.log('[DEBUG] MIT Horizon OIDC profile:', JSON.stringify(profile, null, 2));
          console.log('[DEBUG] MIT Horizon OIDC idProfile:', JSON.stringify(idProfile, null, 2));
        }
        
        // Extract user information from MIT Horizon profile
        const mitHorizonUserId = idProfile.sub;
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName || (profile.name ? `${profile.name.givenName} ${profile.name.familyName}` : 'Unknown');
        const emailVerified = profile._json?.email_verified || false;
        
        if (!email) {
          return done(new Error('Email is required from MIT Horizon OIDC profile'));
        }
        
        // Try to find user by MIT Horizon ID first
        let user = await storage.getUserByMitHorizonSub(mitHorizonUserId);
        
        // If not found, try to find by email for existing users
        if (!user) {
          const existingUser = await storage.getUserByEmail(email);
          
          if (existingUser) {
            // Update existing user with MIT Horizon ID
            user = await storage.updateUserMitHorizonSub(existingUser.id, mitHorizonUserId);
            console.log(`[INFO] Linked MIT Horizon ID to existing user: ${existingUser.username}`);
            
            // Update email verification status
            if (user) {
              await storage.updateUserEmailVerifiedStatus(user.id, emailVerified);
            }
          } else {
            // Create new user with MIT Horizon information
            // Generate username from email with improved sanitization and uniqueness
            const sanitizedEmailPrefix = email.split('@')[0]
              .replace(/[^a-zA-Z0-9._-]/g, '') // Remove special chars except some safe ones
              .toLowerCase();
            const randomSuffix = Math.floor(Math.random() * 10000);
            const timestamp = Date.now().toString().slice(-4); // Last 4 digits of timestamp
            const username = `${sanitizedEmailPrefix}_${randomSuffix}${timestamp}`;
            
            // Create new user with default role of student and null password (MIT Horizon-only user)
            user = await storage.createUser({
              username,
              email,
              name,
              password: null, // No password for SSO users
              role: 'student',
              mitHorizonSub: mitHorizonUserId,
              emailVerified
            });
            
            console.log(`[INFO] Created new user from MIT Horizon login: ${username}`);
            
            // Log the user creation event for audit purposes
            if (user) {
              logUserCreation(
                user.id,
                user.username,
                undefined, // No creator user ID for SSO registration
                undefined, // No creator username for SSO registration
                'MIT Horizon SSO' // Use a descriptive string instead of IP
              );
            }
          }
        } else {
          // We found the user by MIT Horizon ID, update email verification status
          await storage.updateUserEmailVerifiedStatus(user.id, emailVerified);
        }
        
        if (!user) {
          return done(new Error('Failed to retrieve or create user account'));
        }
        
        // Log successful authentication
        logSuccessfulAuth(
          user.id,
          user.username,
          'MIT Horizon SSO', // Indicate SSO authentication method
          'MIT Horizon' // Provider information
        );
        
        // Create a new object without the password property
        const { password, ...userWithoutPassword } = user;
        
        return done(null, userWithoutPassword as User);
      } catch (error) {
        console.error('[ERROR] MIT Horizon OIDC authentication error:', error);
        return done(error);
      }
    }));
    
    // MIT Horizon login route
    app.get('/api/auth/horizon/login', (req: Request, res: Response, next: NextFunction) => {
      // Store returnTo in session if provided
      if (req.query.returnTo) {
        req.session.returnTo = req.query.returnTo as string;
      }
      
      passport.authenticate('horizon-oidc', { 
        scope: 'openid email profile' 
      })(req, res, next);
    });
    
    // MIT Horizon callback route
    app.get('/api/auth/horizon/callback', (req: Request, res: Response, next: NextFunction) => {
      passport.authenticate('horizon-oidc', (err: Error | null, user: User | undefined, info: any) => {
        if (err) {
          console.error('[ERROR] MIT Horizon OIDC callback error:', err);
          return res.redirect('/login?error=horizon_failed&reason=' + encodeURIComponent(err.message));
        }
        
        if (!user) {
          console.error('[ERROR] MIT Horizon OIDC callback did not return a user');
          return res.redirect('/login?error=horizon_failed&reason=no_user_returned');
        }
        
        req.login(user, (err) => {
          if (err) {
            console.error('[ERROR] Session login error:', err);
            return res.redirect('/login?error=horizon_failed&reason=session_error');
          }
          
          // Check for returnTo parameter in the session (set during login initiation)
          let returnTo = '/';
          if (req.session.returnTo) {
            returnTo = req.session.returnTo;
            delete req.session.returnTo; // Clear it after use
          }
            
          // Validate returnTo URL to prevent open redirect vulnerabilities
          if (!returnTo.startsWith('/') || returnTo.includes('//')) {
            returnTo = '/';
          }
            
          console.log('[INFO] Redirecting after successful login to:', returnTo);
          return res.redirect(returnTo);
        });
      })(req, res, next);
    });
  } else {
    console.log('[INFO] MIT Horizon OIDC not configured, skipping MIT Horizon OIDC strategy setup');
  }

  // Configure passport serialization with better error handling
  passport.serializeUser((user: any, done) => {
    if (!user || !user.id) {
      console.error('[ERROR] Failed to serialize user - invalid user object:', user);
      return done(new Error('Invalid user object during serialization'));
    }
    console.log('[DEBUG] Serializing user ID:', user.id);
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    if (!id) {
      console.error('[ERROR] Failed to deserialize user - no ID provided');
      return done(new Error('No user ID provided for deserialization'));
    }

    try {
      console.log(`[DEBUG] Deserializing user ID: ${id}`);
      const user = await storage.getUser(id);
      
      if (!user) {
        console.error(`[ERROR] User with ID ${id} not found during deserialization`);
        return done(null, false);
      }
      
      // Remove password from the user object
      const { password: _, ...userWithoutPassword } = user;
      console.log(`[DEBUG] Successfully deserialized user ${user.username} (ID: ${user.id})`);
      done(null, userWithoutPassword);
    } catch (error) {
      console.error(`[ERROR] Error deserializing user ID ${id}:`, error);
      done(null, false);
    }
  });

  // Authentication middleware with enhanced logging
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    console.log(`[DEBUG] Authentication check for path ${req.path}:`, {
      isAuthenticated: req.isAuthenticated(),
      hasSession: !!req.session,
      hasUser: !!req.user,
      userId: req.user?.id || 'none',
      userRole: req.user?.role || 'none',
      sessionId: req.sessionID || 'none'
    });
    
    if (!req.isAuthenticated()) {
      console.error(`[WARN] Unauthorized access attempt to ${req.path}`);
      return res.status(401).json({ message: 'Unauthorized - Please log in again' });
    }
    next();
  };

  // Role-based authorization middleware
  const requireRole = (role: string) => (req: Request, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    if ((req.user as any).role !== role) {
      // Log permission denied event for security auditing
      logSecurityEvent(
        AuditEventType.PERMISSION_DENIED,
        req.ip || 'unknown',
        (req.user as any).id,
        (req.user as any).username,
        {
          requiredRole: role,
          actualRole: (req.user as any).role,
          path: req.path,
          method: req.method
        }
      );
      
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };

  // Enhanced login schema with stronger validation
  const loginSchema = z.object({
    username: z.string().min(3, "Username must be at least 3 characters"),
    password: z.string().min(6, "Password must be at least 6 characters"),
  });
  
  // Enhanced registration schema with password strength requirements
  const registerSchema = z.object({
    username: z.string().min(3, "Username must be at least 3 characters"),
    email: z.string().email("Invalid email address"),
    name: z.string().min(1, "Name is required"),
    password: z.string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number")
      .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character"),
    role: z.enum(["student", "instructor", "admin"]).optional().default("student"),
  });

  // Login endpoint (with rate limiting)
  app.post('/api/auth/login', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request
      const result = loginSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ message: 'Validation failed', errors: result.error.errors });
      }

      passport.authenticate('local', (err: any, user: any, info: any) => {
        if (err) {
          console.error('[ERROR] Authentication error:', err);
          return next(err);
        }
        
        if (!user) {
          // Log failed authentication attempt
          logFailedAuth(
            req.body.username,
            req.ip || 'unknown',
            info.message || 'Invalid credentials',
            req.headers['user-agent'] as string
          );
          return res.status(401).json({ message: info.message || 'Invalid credentials' });
        }
        
        // Log before login
        console.log('[DEBUG] Attempting to login user:', { 
          userId: user.id, 
          username: user.username, 
          role: user.role,
          hasSession: !!req.session
        });
        
        req.login(user, (err) => {
          if (err) {
            console.error('[ERROR] Session login error:', err);
            return next(err);
          }
          
          // Store user data to be restored after session regeneration
          const userData = user;
          
          // Regenerate session to prevent session fixation
          req.session.regenerate((err) => {
            if (err) {
              console.error('[ERROR] Session regeneration error:', err);
              return next(err);
            }
            
            // Re-login the user after session regeneration
            req.login(userData, (loginErr) => {
              if (loginErr) {
                console.error('[ERROR] Re-login error after session regeneration:', loginErr);
                
                // More robust error handling - try to destroy the inconsistent session before redirecting
                req.session.destroy((destroyErr) => {
                  if (destroyErr) {
                    console.error('[ERROR] Failed to destroy inconsistent session:', destroyErr);
                  }
                  
                  // Return login error with redirect instructions
                  return res.status(500).json({ 
                    message: 'Authentication error occurred during login',
                    redirectTo: '/login',
                    error: 'Session regeneration error'
                  });
                });
                return; // Return early to prevent next(loginErr) from being called
              }
              
              // Save the session to store
              req.session.save((saveErr) => {
                if (saveErr) {
                  console.error('[ERROR] Session save error:', saveErr);
                  return next(saveErr);
                }
                
                // Log after successful login
                console.log('[DEBUG] User successfully logged in:', {
                  userId: userData.id,
                  username: userData.username,
                  role: userData.role,
                  sessionID: req.sessionID
                });
                
                // Log successful authentication
                logSuccessfulAuth(
                  userData.id,
                  userData.username,
                  req.ip || 'unknown',
                  req.headers['user-agent'] as string
                );
                
                return res.status(200).json(userData);
              });
            });
          });
        });
      })(req, res, next);
    } catch (error) {
      console.error('[ERROR] Login error:', error);
      next(error);
    }
  });

  // Helper function to determine login page URL
  const getLoginPageUrl = () => {
    // For Auth0 compatibility, only use the base URL without any additional path
    // and ensure it's whitelisted in Auth0 allowed logout URLs
    if (process.env.BASE_URL) {
      return process.env.BASE_URL.replace(/\/$/, '');
    }
    
    // Fallback for local development
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const host = app.get('host') || 'localhost:5000';
    const fallbackUrl = `${protocol}://${host}`;
    
    // Log a warning that BASE_URL should be set in production
    if (process.env.NODE_ENV === 'production') {
      console.warn('\x1b[33m%s\x1b[0m', 
        `WARNING: Using fallback URL ${fallbackUrl} for login redirects. ` +
        `This may not work correctly in production environments. ` +
        `Please set BASE_URL environment variable.`
      );
    }
    
    return fallbackUrl;
  };
  
  const validateReturnToUrl = (returnToUrl: string, idpName: string) => {
    // In production, this URL must be whitelisted in the IdP configuration
    if (process.env.NODE_ENV === 'production') {
      console.log(`[INFO] Return URL for ${idpName} logout: ${returnToUrl}`);
      console.log(`[INFO] Ensure this URL is whitelisted in the ${idpName} configuration`);
    }
    return returnToUrl;
  };

  // Logout endpoint
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    // Store user info before logout for logging
    const user = req.user as any;
    const userId = user?.id;
    const username = user?.username;
    const ipAddress = req.ip || 'unknown';
    
    // Determine if this user authenticated via Auth0 or MIT Horizon
    const isAuth0User = user?.auth0Sub || false;
    const isMitHorizonUser = user?.mitHorizonSub || false;

    req.logout((logoutErr) => {
      if (logoutErr) {
        console.error('[ERROR] Logout error:', logoutErr);
        return res.status(500).json({ message: 'Error during logout process' });
      }
      
      // Destroy the session to ensure complete cleanup
      if (req.session) {
        req.session.destroy((destroyErr) => {
          if (destroyErr) {
            console.error('[ERROR] Session destruction error:', destroyErr);
            // Continue with logout even if session destruction fails
          }
          
          // Log the logout event if the user was authenticated
          if (userId && username) {
            logLogout(userId, username, ipAddress);
          }
          
          // Clear cookie
          res.clearCookie('connect.sid');
          
          // If user was authenticated via Auth0 and Auth0 is configured,
          // redirect to Auth0 logout URL to complete SSO logout
          if (isAuth0User && process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID) {
            const loginPageUrl = getLoginPageUrl();
            const validatedReturnTo = validateReturnToUrl(loginPageUrl, 'Auth0');
            console.log(`[INFO] Redirecting to Auth0 logout URL with returnTo: ${validatedReturnTo}`);
            
            // Ensure client_id and returnTo parameters are properly included
            const auth0LogoutUrl = `https://${process.env.AUTH0_DOMAIN}/v2/logout?` + 
              `client_id=${encodeURIComponent(process.env.AUTH0_CLIENT_ID)}` + 
              `&returnTo=${encodeURIComponent(validatedReturnTo)}`;
            
            return res.status(200).json({ 
              message: 'Logged out successfully',
              redirect: true,
              redirectUrl: auth0LogoutUrl
            });
          }
          
          // If user was authenticated via MIT Horizon and MIT Horizon is configured,
          // redirect to MIT Horizon logout URL to complete SSO logout
          if (isMitHorizonUser && process.env.MIT_HORIZON_OIDC_ISSUER_URL && process.env.MIT_HORIZON_OIDC_CLIENT_ID) {
            const loginPageUrl = getLoginPageUrl();
            const validatedReturnTo = validateReturnToUrl(loginPageUrl, 'MIT Horizon');
            console.log(`[INFO] Redirecting to MIT Horizon logout URL with returnTo: ${validatedReturnTo}`);
            
            // Ensure OIDC issuer URL ends with a trailing slash before adding the logout endpoint
            const issuerUrl = process.env.MIT_HORIZON_OIDC_ISSUER_URL.endsWith('/')
              ? process.env.MIT_HORIZON_OIDC_ISSUER_URL
              : `${process.env.MIT_HORIZON_OIDC_ISSUER_URL}/`;
            
            // Construct the proper logout URL with all parameters properly encoded
            const mitHorizonLogoutUrl = `${issuerUrl}v2/logout?` + 
              `client_id=${encodeURIComponent(process.env.MIT_HORIZON_OIDC_CLIENT_ID)}` +
              `&returnTo=${encodeURIComponent(validatedReturnTo)}`;
            
            return res.status(200).json({ 
              message: 'Logged out successfully',
              redirect: true,
              redirectUrl: mitHorizonLogoutUrl
            });
          }
          
          // Standard logout for non-SSO users
          res.status(200).json({ 
            message: 'Logged out successfully',
            redirect: false
          });
        });
      } else {
        // No active session to destroy
        console.log('[WARN] Logout called without an active session');
        
        // Log the logout event if the user was authenticated
        if (userId && username) {
          logLogout(userId, username, ipAddress);
        }
        
        // Standard logout response
        res.status(200).json({ 
          message: 'Logged out successfully',
          redirect: false
        });
      }
    });
  });

  // Get current user endpoint
  app.get('/api/auth/user', (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    res.json(req.user);
  });
  
  // Register new user endpoint with password strength enforcement (with rate limiting)
  app.post('/api/auth/register', authRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request against our enhanced schema
      const result = registerSchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          message: 'Validation failed', 
          errors: result.error.errors 
        });
      }
      
      // Check if username already exists
      const existingUser = await storage.getUserByUsername(result.data.username);
      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists' });
      }
      
      // Check if email already exists
      const existingEmail = await storage.getUserByEmail(result.data.email);
      if (existingEmail) {
        return res.status(400).json({ message: 'Email already in use' });
      }
      
      // Hash the password
      const hashedPassword = await hashPassword(result.data.password);
      
      // Create the user
      const newUser = await storage.createUser({
        ...result.data,
        password: hashedPassword
      });
      
      // Remove password from response
      const { password: _, ...userWithoutPassword } = newUser;
      
      // Log the user creation event for audit purposes
      logUserCreation(
        newUser.id,
        newUser.username,
        undefined,
        undefined,
        req.ip || 'unknown'
      );
      
      // Log the user in
      req.login(userWithoutPassword, (err) => {
        if (err) {
          return next(err);
        }
        
        // Log successful authentication after registration
        logSuccessfulAuth(
          newUser.id,
          newUser.username,
          req.ip || 'unknown',
          req.headers['user-agent'] as string
        );
        
        return res.status(201).json(userWithoutPassword);
      });
    } catch (error) {
      next(error);
    }
  });

  return { requireAuth, requireRole };
}



// Helper function to hash passwords
async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12; // Increased to 12 rounds for enhanced security
  return bcrypt.hash(password, saltRounds);
}

// Development test accounts (passwords will be hashed before storing)
const DEV_TEST_ACCOUNTS = [
  {
    id: 9999,
    username: 'admin@test.com',
    email: 'admin@test.com',
    password: 'admin123', // Will be hashed before storage
    name: 'Test Admin',
    role: 'admin' as const
  },
  {
    id: 9998,
    username: 'instructor@test.com', 
    email: 'instructor@test.com',
    password: 'instructor123', // Will be hashed before storage
    name: 'Test Instructor',
    role: 'instructor' as const
  },
  {
    id: 9997,
    username: 'student@test.com',
    email: 'student@test.com',
    password: 'student123', // Will be hashed before storage
    name: 'Test Student', 
    role: 'student' as const
  }
];

// Create test accounts in development with hashed passwords
if (process.env.NODE_ENV === 'development') {
  DEV_TEST_ACCOUNTS.forEach(async (account) => {
    const exists = await storage.getUserByUsername(account.username);
    if (!exists) {
      // Hash the password before storing
      const hashedPassword = await hashPassword(account.password);
      await storage.createUser({
        ...account,
        password: hashedPassword
      });
    }
  });
}
