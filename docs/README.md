# AIGrader Documentation

This directory contains comprehensive documentation for the AIGrader platform.

## Documentation Overview

### Gemini API Reference

The [Gemini API References](./gemini_references/index.md) directory contains detailed documentation for Google's Gemini API integration in our application:

- **Core Capabilities**
  - [Prompting Strategies](./gemini_references/prompting-strategies.md) - Best practices and strategies for designing effective prompts
  - [Text Generation](./gemini_references/text-generation.md) - Basic text generation capabilities and configuration
  - [Image Understanding](./gemini_references/image-understanding.md) - Using Gemini for processing and analyzing images
  - [Document Understanding](./gemini_references/document-understanding.md) - Working with PDFs and other document formats
  - [Structured Output](./gemini_references/structured-output.md) - Generating JSON and other structured formats

- **Advanced Features**
  - [Files API Overview](./gemini_references/files-api-overview.md) - Working with the Gemini Files API for file uploads
  - [Parts and Content](./gemini_references/parts-and-content.md) - Multi-part content in requests and responses
  - [Function Calling](./gemini_references/function-calling.md) - Implementing function calling capabilities
  - [Code Execution](./gemini_references/code-execution.md) - Generating and executing code with Gemini
  - [Caching](./gemini_references/caching.md) - Context caching API for improved performance

- **Reference Material**
  - [Schema Reference](./gemini_references/schema-reference.md) - Detailed schema definitions for all API resources

### Architecture Documentation

- **Server Architecture**
  - Refer to [Server README](../server/README.md) for backend architecture details
  - AI Adapter pattern implementation
  - Queue system for batch processing

- **Client Architecture**
  - Refer to [Client README](../client/README.md) for frontend architecture details

### System Configuration

- [Redis Configuration Guide](../REDIS_CONFIGURATION.md) - Detailed Redis setup instructions
- [Build Optimization Guide](../BUILD_OPTIMIZATION.md) - Production build configuration
- [Authentication Guides](../AUTH0_CONFIGURATION.md) - Auth0 and MIT Horizon OIDC integration

### Security Documentation

- [Security Policy and Practices](../SECURITY.md) - Security requirements and best practices
- [Security Fixes](../SECURITY_FIXES.md) - Documentation of security improvements
- [Marketing Overview](./marketing-overview.md) - Messaging highlights for outreach

## Using This Documentation

This documentation is designed to be a comprehensive resource for developers working on the AIGrader platform. When implementing features that use Gemini API capabilities:

1. First, consult the appropriate reference document in the `gemini_references` directory
2. See the relevant adapter implementation in `server/adapters`
3. Refer to test scripts in the root directory for examples (files starting with `test-`)

## Updating Documentation

When making significant changes to the codebase, especially to Gemini API integration or file processing functionality, please keep the documentation up to date by:

1. Adding examples of new capabilities
2. Documenting any API changes
3. Updating schemas when new fields are added

This ensures that future developers can easily understand and maintain the codebase.