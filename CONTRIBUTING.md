# Contributing to Video2PDF

Thank you for your interest in contributing to **Video2PDF**! We welcome community contributions to help improve lecture document extraction, deduplication, and computer vision pipelines.

---

## Code of Conduct

Please be respectful and constructive in all issues, pull requests, and discussions.

---

## Getting Started

1. **Fork the Repository** on GitHub: [lecture_note_extractor](https://github.com/muhammednawaf/lecture_note_extractor)
2. **Clone your fork**:
   ```bash
   git clone https://github.com/<your-username>/lecture_note_extractor.git
   cd lecture_note_extractor
   ```
3. **Install Dependencies**:
   ```bash
   # Backend
   cd backend
   npm install

   # Frontend
   cd ../frontend
   npm install
   ```

---

## Development Workflow

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Run local development servers:
   ```bash
   # In backend/
   npm run dev

   # In frontend/
   npm run dev
   ```
3. Ensure all tests and TypeScript builds pass:
   ```bash
   cd backend
   npm run build
   for test in src/tests/*.ts; do npx tsx $test; done

   cd ../frontend
   npm run build
   ```

---

## Submitting Pull Requests

1. Commit your changes with clear, semantic commit messages (e.g. `feat: ...`, `fix: ...`, `docs: ...`).
2. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
3. Open a Pull Request against the `main` branch with a summary of changes and test results.

---

## License

By contributing to Video2PDF, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
