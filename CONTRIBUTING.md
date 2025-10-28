# Contributing to Netlify RAG Chatbot

Thank you for your interest in contributing to Netlify RAG Chatbot! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)

## Code of Conduct

This project follows a simple code of conduct: be respectful, be constructive, and help create a welcoming environment for all contributors.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR-USERNAME/netlify-rag-chatbot.git
   cd netlify-rag-chatbot
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Set up environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```
5. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## How to Contribute

### Reporting Bugs

If you find a bug, please create an issue with:

- **Clear title** describing the issue
- **Detailed description** of the problem
- **Steps to reproduce** the issue
- **Expected behavior** vs actual behavior
- **Environment details** (Node version, OS, etc.)
- **Screenshots** if applicable

### Suggesting Features

Feature suggestions are welcome! Please create an issue with:

- **Clear description** of the feature
- **Use case** - why is this feature needed?
- **Proposed implementation** (if you have ideas)
- **Alternatives considered**

### Submitting Changes

1. Make your changes in your feature branch
2. Test your changes thoroughly
3. Update documentation if needed
4. Submit a pull request

## Development Workflow

### Local Development

```bash
# Start development server
npm run netlify:dev

# Build for production
npm run build

# Test the production build
npm run preview
```

### Testing Your Changes

Before submitting a PR, ensure:

- [ ] The project builds successfully (`npm run build`)
- [ ] All existing functionality still works
- [ ] New features are working as expected
- [ ] No console errors or warnings
- [ ] Environment variables are properly documented

### Database Changes

If your contribution involves database schema changes:

1. Update the appropriate schema files in `src/lib/db/`
2. Create migration scripts if needed
3. Document the changes in your PR
4. Test with both fresh databases and migrations

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Avoid `any` types when possible
- Add JSDoc comments for public functions
- Use descriptive variable and function names

### Code Style

- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings (except JSON)
- **Semicolons**: Use them
- **Line length**: Aim for 100 characters max
- **Naming conventions**:
  - `camelCase` for variables and functions
  - `PascalCase` for types and classes
  - `UPPER_CASE` for constants

### File Organization

- Keep functions focused and single-purpose
- Extract reusable logic into separate modules
- Group related functionality together
- Add comments for complex logic

### Example:

```typescript
/**
 * Retrieves embeddings from the database using hybrid search
 * @param query - The search query text
 * @param ragId - The RAG database identifier
 * @param options - Search configuration options
 * @returns Array of matching embeddings with scores
 */
async function searchEmbeddings(
  query: string,
  ragId: string,
  options: SearchOptions
): Promise<Embedding[]> {
  // Implementation
}
```

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```
feat(search): add BM25 hybrid search support

Implemented hybrid search combining vector similarity and BM25 text search
for improved retrieval accuracy.

Closes #123
```

```
fix(query): handle empty query results gracefully

Previously threw an error when no results found. Now returns empty array
with appropriate message.
```

## Pull Request Process

### Before Submitting

1. **Update documentation** - README.md, code comments, etc.
2. **Test thoroughly** - ensure nothing is broken
3. **Update CHANGELOG** - if applicable
4. **Rebase on main** - ensure your branch is up to date

### PR Template

When creating a PR, include:

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Changes Made
- List of specific changes
- Another change
- etc.

## Testing
How was this tested?

## Checklist
- [ ] Code builds successfully
- [ ] All tests passing
- [ ] Documentation updated
- [ ] No console errors
- [ ] Environment variables documented (if applicable)
```

### Review Process

1. A maintainer will review your PR
2. Address any feedback or requested changes
3. Once approved, a maintainer will merge your PR
4. Your changes will be included in the next release

## Areas for Contribution

Here are some areas where contributions are especially welcome:

### High Priority

- **Additional embedding models** - Support for more model types
- **Search improvements** - Better ranking algorithms
- **Performance optimization** - Faster query processing
- **Error handling** - More robust error recovery

### Nice to Have

- **UI improvements** - Better user interface
- **Testing** - Unit and integration tests
- **Documentation** - More examples and tutorials
- **Deployment guides** - Other platforms besides Netlify

### Feature Ideas

- Export/import chat history
- Custom prompt templates
- Multi-language support
- Advanced filtering options
- Analytics dashboard

## Questions?

If you have questions about contributing:

1. Check existing issues and discussions
2. Create a new issue with the `question` label
3. Reach out to the maintainers

## Recognition

Contributors will be recognized in:

- README.md Contributors section
- Release notes
- Project documentation

Thank you for contributing to Netlify RAG Chatbot! 🎉
