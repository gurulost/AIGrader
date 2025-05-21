# AIGrader - Agent Contributor Guide

This document provides essential guidance for AI agents working with the AIGrader platform, focusing on best practices for prompt engineering, Gemini API usage, and AI-powered assessment.

## Overview

The AIGrader platform is designed to enhance educational workflows through intelligent error handling and robust parsing mechanisms, scaling for large classes.

- **Main Project README**: For a comprehensive overview of the project, features, technology stack, and setup, please refer to the main [README.md](README.md).
- **Directory Structure**: A detailed directory structure is available in the main [README.md](README.md). Familiarize yourself with the `client/`, `server/`, `shared/`, and `test/` directories.

## Critical AI Integration Documentation

**This is the most critical section for tasks involving AI functionality.**

### Required Documentation Resources

All agents MUST review these key resources before working with the AIGrader codebase:

- **[Gemini Prompting Strategies](docs/gemini_references/prompting-strategies.md)**: Comprehensive guide to designing effective prompts, including examples and best practices
- **[Gemini API Reference Index](docs/gemini_references/index.md)**: Central hub for all Gemini API capabilities
- **[Text Generation Guide](docs/gemini_references/text-generation.md)**: Core text generation capabilities
- **[Image Understanding Guide](docs/gemini_references/image-understanding.md)**: Processing and analyzing images
- **[Document Understanding Guide](docs/gemini_references/document-understanding.md)**: Working with PDFs and documents
- **[Structured Output Guide](docs/gemini_references/structured-output.md)**: Generating JSON and structured formats
- **[Function Calling Guide](docs/gemini_references/function-calling.md)**: Using function calling with Gemini
- **[Files API Overview](docs/gemini_references/files-api-overview.md)**: Working with the Gemini Files API for file uploads
- **[Parts and Content](docs/gemini_references/parts-and-content.md)**: Multi-part content in requests and responses
- **[Code Execution](docs/gemini_references/code-execution.md)**: Generating and executing code with Gemini
- **[Caching](docs/gemini_references/caching.md)**: Context caching API for improved performance
- **[Schema Reference](docs/gemini_references/schema-reference.md)**: Detailed schema definitions for all API resources

**Before implementing any changes to AI features, verify your understanding by reviewing the relevant `docs/gemini_references/` documents.**

## Development Environment Setup

- **Prerequisites**: Ensure Node.js and PostgreSQL are installed
- **Installation**: Run `npm install` to install dependencies
- **Environment Variables**: Copy `.env.example` to `.env` and configure as needed. Critical variables include `NODE_ENV`, `GEMINI_API_KEY`, `DATABASE_URL`, and Redis settings
- **Database Setup**: Run `npm run db:push` to migrate database schema changes
- **Development Server**: Run `npm run dev` to start the development server (runs both backend and frontend with hot reloading)
- For testing Gemini API changes, use the example scripts in the `scripts/` directory (e.g., `scripts/test-gemini-adapter.js`)
- Test image upload handling with small images (< 5MB) using data URIs
- For larger files, use the Files API with proper MIME type specification

## Testing Instructions

Comprehensive testing is crucial for maintaining quality:

- **Running All Tests**: `npm test`
- **Specific Test Types**:
  ```bash
  ./test/run-tests.sh unit
  ./test/run-tests.sh integration
  ./test/run-tests.sh components
  ./test/run-tests.sh e2e
  ```
- **Linting**: `npm run lint`
- **Type Checking**: `npm run typecheck` or `npm run check`
- **Validation**:
  - All code changes should pass relevant tests
  - Fix any test or type errors until the entire suite passes
  - After moving files or changing imports, run linting to ensure rules still pass
  - Add or update tests for the code you change, even if not explicitly asked

## File Structure Conventions

Key directories to understand:
- `/server/adapters`: Contains all AI service adapters, including Gemini
- `/server/utils`: Contains essential utilities including `gemini-file-handler.ts`
- `/server/services`: Business logic including `ai-service.ts`
- `/docs/gemini_references`: All Gemini API documentation
- `/shared/schema.ts`: Data models and shared types

## Effective Prompt Design Guidelines

When designing prompts (i.e., when Codex is writing or modifying prompts that AIGrader will send to the Gemini API), follow these principles, guided by the detailed [Prompting Strategies Guide](docs/gemini_references/prompting-strategies.md):

1.  **Be clear and specific**: Provide explicit instructions to minimize ambiguity. This aligns with the guidance to provide clear and specific instructions to customize model behavior.
2.  **Prefer few-shot examples for clarity and consistency**:
    * While zero-shot prompts (no examples) can be effective for simpler tasks if instructions are very clear, few-shot examples (typically 2-3) can sometimes be helpful for guiding the Gemini model. They are often more effective for complex tasks, achieving specific output formatting, or conveying nuanced response patterns.
    * The goal is to provide the clearest possible guidance to the model. Sometimes, clear instructions suffice; often, examples make the desired output unambiguous.
    * Always refer to the main [Prompting Strategies Guide](docs/gemini_references/prompting-strategies.md) for detailed advice on when and how to use few-shot examples, and when experimentation might be needed.
3.  **Add relevant context**: Provide necessary background information or data the model needs.
4.  **Format responses appropriately**: Request specific output formats (e.g., JSON, markdown) if needed, and consider using the completion strategy to guide formatting.
5.  **Break down complex tasks**: Divide multi-step assignments into smaller, more manageable prompt components or chains if necessary.
6.  **Apply constraints**: Set explicit boundaries on response length, style, or what the model should or shouldn't do.

## Multimodal Content Processing

When working with images, documents, and other media:

1. **Use data URIs for small images**: For images under 5MB, convert to base64 data URIs
2. **Use Files API for larger content**: For files over 5MB, use the Gemini Files API
3. **Always specify content types**: Include MIME types with all file uploads
4. **Validate file formats**: Check file extensions and MIME types before processing
5. **Handle binary data properly**: Use Buffer for binary content and ensure proper encoding

## Gemini API Configuration

Configure the Gemini API with these parameters:

1. **Temperature**: Use 0.2-0.4 for factual assessment, 0.7-0.9 for creative feedback
2. **TopP**: Default to 0.95 for most educational assessment tasks
3. **Max tokens**: 800-1500 for standard feedback, 2000+ for detailed analyses
4. **Response format**: Set `responseMimeType` to "application/json" for structured outputs
5. **System instructions**: Use to set global behavioral constraints

## PR Instructions

When submitting changes:

1. **Title Format**: `[area_of_code] Brief description of changes` (e.g., `[server/gemini] Fix for file upload handling`)
2. **Description**:
   - Clearly describe the problem and the solution
   - Reference any relevant issue numbers
   - Detail how to test the changes
   - **Explicitly state which `docs/gemini_references/` documents were consulted if the changes involve AI/Gemini API features**
3. **Code Quality Requirements**:
   - **Testing**: All changes must pass existing tests and include new tests for added functionality
   - **Documentation**: Update relevant docs in `/docs/gemini_references/` when changing API behavior
   - **Error handling**: Implement robust error handling for API failures
   - **Performance**: Consider token usage and optimize prompts for efficiency
   - **Accessibility**: Ensure all feedback is clearly formatted and easy to understand

## Best Practices for AI Assessment

When implementing AI-powered grading:

1. **Follow rubric criteria**: Ensure feedback aligns with defined rubric criteria
2. **Provide actionable feedback**: Give specific suggestions for improvement
3. **Balance criticism with encouragement**: Highlight strengths while addressing weaknesses
4. **Be evidence-based**: Reference specific parts of submissions in feedback
5. **Maintain consistency**: Use consistent evaluation standards across submissions

## Implementing Gemini Functionality

When writing code that uses Gemini:

1. **Use the adapter pattern**: All AI interactions should go through the adapter interface
2. **Implement robust error handling**: Catch and handle API errors gracefully
3. **Handle multimodal content correctly**: Use established patterns for image and document processing
4. **Cache responses when appropriate**: Use Redis caching for identical prompts
5. **Track token usage**: Log consumption for monitoring and optimization

## How to Work in This Repository

1. **Understand the Task**: Clarify the requirements.
2. **Consult Documentation**:
   - For general structure, refer to the main [README.md](README.md) and specific directory READMEs.
   - **For ANY AI-related tasks (Gemini API, prompts, AI feedback logic), ALWAYS start with [docs/README.md](docs/README.md) and dive deep into the relevant files within [docs/gemini_references/](docs/gemini_references/).**
3. **Locate Relevant Code**: Use the directory structure and READMEs to find the modules you need to modify.
4. **Implement Changes**: Write clear, maintainable code following established patterns.
5. **Test Thoroughly**: Run relevant tests and add new tests as needed.
6. **Validate**: Run linters and type checkers.
7. **Document**: Update any necessary documentation, especially for AI changes.
8. **Prepare PR**: Follow the PR instructions above.

## Internal Implementation Details

Implementation specifics:
- Gemini adapter follows the adapter pattern defined in `server/adapters/interfaces.ts`
- File handling utilities in `server/utils/gemini-file-handler.ts` handle data URIs and Files API
- Response schemas follow the formats defined in `server/schemas/gradingSchema.ts`
- Token usage tracking implemented in adapter response handling
- AI adapters are in `server/adapters/` with the primary Gemini adapter at `server/adapters/gemini-adapter.ts`
- The general AI adapter interface is defined in `server/adapters/ai-adapter.ts`

For detailed information on architecture and implementation, refer to:
- [Server Documentation](server/README.md)
- [Client Documentation](client/README.md)
- [Shared Types Documentation](shared/README.md)
- [Testing Documentation](test/README.md)
- [Gemini Adapter Improvements](gemini_adapter_improvements.md)