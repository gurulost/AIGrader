# Security Policy and Practices

This document outlines security measures, considerations, and best practices for the AIGrader platform.

## Critical Security Requirements

### Environment Variables and Secrets

- **SESSION_SECRET**: Required for secure session management. Must be a strong, unique, random value (at least 32 characters).
- **CSRF_SECRET**: Required for CSRF protection. Must be a strong, unique, random value (at least 32 characters).

Both of these values are **required** and the application will fail to start if they are not properly set. To generate suitable values:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Shareable Link Security

Submissions initiated from a shareable link require authentication and validation:

1. Each assignment has a unique `shareableCode` generated when the assignment is created
2. Students must log in or sign up before submitting via the link
3. The server validates that the provided `shareableCode` matches the assignment's stored code
4. Submissions are rejected with a 403 Forbidden status if the codes don't match

This prevents unauthorized submissions or guessing of assignment IDs.

## Authentication and Authorization

- Password hashing is implemented using bcrypt with appropriate salt rounds
- Role-based access control restricts endpoints to appropriate user roles
- Session cookies are configured with secure settings:
  - HttpOnly: Prevents client-side JavaScript from accessing cookies
  - Secure: (In production) Requires HTTPS
  - SameSite: Strict or Lax to prevent CSRF attacks
  - Path restricted to root

## Additional Security Measures

- CSRF protection with double-submit technique
- Comprehensive security headers via Helmet middleware:
  - Content-Security-Policy: Restricts resource loading to trusted sources
  - X-Frame-Options: Prevents clickjacking with 'DENY' setting
  - X-XSS-Protection: Enables browser XSS filters
  - X-Content-Type-Options: Prevents MIME-sniffing
  - Strict-Transport-Security: (In production) Enforces HTTPS with long-term caching
  - Referrer-Policy: Controls information in the Referer header
  - Feature-Policy/Permissions-Policy: Restricts browser features
  
## Rate Limiting

The application implements rate limiting to protect against abuse, brute force attacks, and potential DoS attempts:

| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| `/api/auth/login` | 10 requests | 1 minute | Prevent brute force login attempts |
| `/api/auth/register` | 10 requests | 1 minute | Prevent mass account creation |
| `/api/anonymous-submissions` | 5 requests | 1 minute | Protect AI service from abuse |
| `/api/assignments/code/:code` | 100 requests | 15 minutes | Prevent excessive assignment lookups |
| `/api/csrf-token` | 20 requests | 1 minute | Allow reasonable token refresh rate |

Rate limits are enforced on a per-IP basis, with proper consideration for proxies through use of X-Forwarded-For headers when configured. Rate limits are disabled in development mode for easier testing.

## Development vs. Production

The application has stricter security settings in production:

- Session cookies are marked as secure in production (requires HTTPS)
- SameSite cookie setting is 'strict' in production vs. 'lax' in development
- HTTP Strict Transport Security headers are enabled in production
- Error messages are less verbose in production to avoid information disclosure

## Security Testing

Our security features have been extensively tested to ensure they function correctly. The security tests cover:

1. **Environment Variable Validation**
   - Tests validating required secrets (SESSION_SECRET, CSRF_SECRET)
   - Tests confirming application behavior when secrets are missing or insecure
   - Tests ensuring more stringent requirements in production mode

2. **Rate Limiting**
   - Tests validating different rate limiters are correctly configured
   - Tests confirming rate limiting is properly applied in production
   - Tests verifying rate limiting is bypassed in development
   - Tests validating proper handling of proxy IPs

3. **Shareable Code Validation**
   - Tests ensuring shareable link submissions require a valid shareable code
   - Tests verifying code validation against assignment ID
   - Tests confirming proper error responses for invalid codes
   - Tests checking proper error handling

4. **CSRF Protection**
   - Tests ensuring requests without valid CSRF tokens are rejected
   - Tests confirming requests with valid CSRF tokens are accepted
   - Tests verifying secure token generation
   - Tests validating secure cookie settings in production
   - Tests confirming CSRF protection is applied to all non-GET routes

5. **Password Security**
   - Tests verifying bcrypt is used with proper salt rounds
   - Tests confirming password hashing creates secure hashes
   - Tests validating correct passwords verify successfully
   - Tests ensuring incorrect passwords are rejected
   - Tests checking that same password produces different hashes

All security tests can be found in the `test/unit/` directory.

## Dependency Management and Auditing

The application relies on various open-source dependencies, and it's crucial to manage them securely:

1. **Regular Dependency Auditing**
   - Run `npm audit` regularly to identify packages with known vulnerabilities
   - Apply fixes with `npm audit fix` when safe to do so
   - Update packages to their latest secure versions

2. **Key Dependencies**
   - Express 4.x: Core web framework with regular security updates
   - Helmet: Comprehensive HTTP security headers
   - BcryptJS: Secure password hashing
   - CSRF-CSRF: Advanced CSRF protection
   - Express-Rate-Limit: Protection against brute force attacks

3. **Dependency Update Policy**
   - Review security bulletins for critical dependencies weekly
   - Schedule monthly dependency updates for non-critical fixes
   - Test application thoroughly after any dependency updates

Run the following command before deployments to verify dependency security:
```bash
npm audit --production
```

## Security Bug Reporting

If you discover a security vulnerability, please report it responsibly by contacting the maintainers directly rather than opening a public issue.