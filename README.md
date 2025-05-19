# AIGrader - AI-Powered Assignment Feedback Platform

An AI-powered assignment feedback platform that enhances educational workflows through intelligent error handling and robust parsing mechanisms. Designed to scale for large classes with potentially tens of thousands of students.

## Key Features

- **AI-Driven Feedback**: Analyze student submissions and provide constructive feedback using Google's Gemini model
- **Multi-User Roles**: Support for students, instructors, and administrators
- **Course Management**: Organize assignments by courses
- **Rubric Creation**: Create rubrics to guide the AI assessment
- **Submissions Management**: Track student submissions and progress
- **Batch Processing**: Handle large volumes of submissions through a robust queue system
- **Analytics Dashboard**: Visualize student performance and submission patterns
- **Anonymous Submissions**: Support for shareable links that don't require student accounts

## Technology Stack

- **Frontend**: React.js with TypeScript and Tailwind CSS + Shadcn UI
- **Backend**: Express.js with PostgreSQL database
- **ORM**: Drizzle ORM for type-safe database interactions
- **Authentication**: Secure authentication with bcrypt password hashing and CSRF protection
- **Queue**: BullMQ for reliable asynchronous job processing
- **Cache**: Redis for session storage and queue management
- **AI Integration**: Modular AI service with adapters for Google Gemini and OpenAI

## Environment Variables

The application relies on several environment variables for configuration. Copy the `.env.example` file to `.env` and modify it as needed.

### Critical Configuration Variables

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | When set to 'production', enables production optimizations and activates Redis/BullMQ by default |
| `ENABLE_REDIS` | Set to 'true' to enable Redis and BullMQ even in non-production environments |
| `REDIS_URL` | Complete Redis connection string (e.g., redis://username:password@host:port). Takes precedence over individual Redis parameters |
| `REDIS_HOST`, `REDIS_PORT`, etc. | Individual Redis connection parameters used if REDIS_URL is not provided |
| `GEMINI_API_KEY` | API key for Google's Gemini AI model |
| `OPENAI_API_KEY` | Alternative API key for OpenAI models (Gemini is used by default if both are provided) |
| `DATABASE_URL` | PostgreSQL connection string |

See `.env.example` for a complete list of environment variables and their descriptions.

## Redis and Queue Configuration

The application uses BullMQ with Redis for robust queue processing:

- In **production** mode (`NODE_ENV=production`), a Redis connection is required
- In **development** mode, a mock implementation is used by default
- Set `ENABLE_REDIS=true` in development to test with a real Redis instance
- Ensure proper Redis credentials are configured when using a real Redis instance

## Database Setup

The project uses PostgreSQL with Drizzle ORM:

1. Ensure PostgreSQL is installed and running
2. Set up the database connection in the `.env` file
3. Run migrations: `npm run db:push`

## Installation and Setup

```bash
# Clone the repository
git clone <repository-url>

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npm run db:push

# Start the development server
npm run dev
```

## Development

The development server runs the Express backend and the React frontend in a single process, with automatic hot reloading.

```bash
npm run dev
```

## Directory Structure

The project is organized into the following main directories:

```
/
├── client/              # React frontend application
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── hooks/       # Custom React hooks
│   │   ├── lib/         # Utility functions and types
│   │   └── pages/       # Page components
│   └── index.html       # HTML template
│
├── server/              # Express backend application
│   ├── adapters/        # AI service adapters
│   ├── config/          # Environment-specific configurations
│   ├── lib/             # Utility libraries
│   ├── queue/           # BullMQ implementation
│   └── services/        # Business logic
│
├── shared/              # Code shared between client and server
│   ├── enums.ts         # Shared enum definitions
│   └── schema.ts        # Database schema and shared types
│
├── test/                # Test files
│
└── attached_assets/     # Additional assets for the project
```

Detailed README files are available in each major directory:
- [Server Documentation](server/README.md)
- [Client Documentation](client/README.md)
- [Shared Types Documentation](shared/README.md)

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the development server (both frontend and backend) |
| `npm run build` | Build the application for production |
| `npm start` | Start the production server after building |
| `npm run db:push` | Push schema changes to the database |
| `npm test` | Run tests |
| `npm run lint` | Lint the codebase |
| `npm run typecheck` | Check TypeScript types |

## Production Deployment

For production deployment:

1. Set `NODE_ENV=production` in your environment
2. Ensure Redis is configured with proper credentials
3. Set up a PostgreSQL database and configure the connection
4. Build the application: `npm run build`
5. Start the server: `npm start`

For more detailed information about production optimizations, see [BUILD_OPTIMIZATION.md](BUILD_OPTIMIZATION.md).

## Additional Documentation

- [Redis Configuration Guide](REDIS_CONFIGURATION.md): Detailed Redis setup instructions
- [Build Optimization Guide](BUILD_OPTIMIZATION.md): Production build configuration
- [Security Policy and Practices](SECURITY.md): Security requirements and best practices

## License

[MIT License](LICENSE)
