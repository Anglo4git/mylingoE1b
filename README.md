MYLINGO

Interactive English Learning Platform

MYLINGO is a browser-based English learning application designed to deliver structured English lessons, exercises, quizzes, learner progress, and offline learning.

The project is designed around a modular course/content structure so that lessons and quizzes can be updated without rebuilding the entire learning experience manually.

⸻

Project Status

Current status: Development / Release Candidate

The current repository is a development and release-validation workspace.

The project must not be considered officially release-ready until the complete release gate has been executed successfully and the exact tested artifact has been verified as the artifact intended for deployment.

⸻

Repository Structure

MYLINGO/
│
├── README.md
├── .gitignore
├── package.json
├── package-lock.json
├── playwright.config.js
├── RELEASE_IDENTITY.json
├── master_source.csv
│
├── site/
│   └── Web application
│
├── course_content/
│   └── Courses, lessons and quizzes
│
├── scripts/
│   └── Build, validation and QA scripts
│
├── tests/
│   └── Automated tests
│
├── ci/
│   └── Release and CI scripts
│
└── docs/
    └── Project documentation and handoffs

⸻

Main Components

site/

This is the main browser application.

It contains the user-facing MYLINGO learning experience, including:

* HTML
* CSS
* JavaScript
* application assets
* lesson interface
* quiz interface
* learner interface
* offline functionality
* service worker
* offline manifests and packs

When deploying the web application, this directory is the primary application content.

⸻

course_content/

This contains the structured MYLINGO learning content.

It includes course, unit, lesson and quiz data used by the application.

The content system is designed so that new lessons and quizzes can be injected into the application without redesigning the entire application.

⸻

master_source.csv

This is the master source content file used during course/content production and validation.

It should remain under version control because it represents source learning content rather than generated build output.

⸻

scripts/

Contains project automation and validation scripts.

Examples include:

* release identity verification
* content validation
* build validation
* JavaScript validation
* placement/coverage checks
* release preparation

⸻

tests/

Contains automated testing.

Testing may include:

* unit tests
* integration tests
* end-to-end tests
* accessibility tests
* core quiz-flow tests
* offline tests
* regression tests

⸻

ci/

Contains release and continuous-integration automation.

The release pipeline is intended to validate the application before a release artifact is produced.

⸻

Development

Install project dependencies:

npm install

⸻

Useful Commands

Run linting:

npm run lint

Run type checking:

npm run typecheck

Run tests:

npm test

Run coverage:

npm run coverage

Run end-to-end tests:

npm run test:e2e

Run accessibility tests:

npm run test:a11y

Run the core quiz-flow tests:

npm run test:e2e:core

Verify release identity:

npm run release:verify-identity

Run the release gate:

npm run release:gate

⸻

Release Principle

MYLINGO follows an important release rule:

The artifact that is tested must be the exact artifact that is released.

A generated release directory or ZIP must therefore not be treated as a valid release merely because the source repository passes individual checks.

The final release process must establish:

1. the source identity;
2. the generated release artifact;
3. successful validation;
4. successful browser testing;
5. successful accessibility testing;
6. successful content validation;
7. successful build validation;
8. final artifact identity.

⸻

Offline Learning

MYLINGO includes offline-learning infrastructure.

Offline resources are organized through the application’s offline manifests and learning packs.

The project supports course-level offline packaging for the learning levels represented in the application.

Offline functionality must be tested in an actual browser environment before being certified for release.

⸻

Course Content

The current content structure includes:

* Courses
* Units
* Lessons
* Quizzes
* Quiz references
* Level-specific content

Content should be modified through the appropriate source files rather than by manually changing generated release output.

⸻

Testing Philosophy

MYLINGO uses multiple layers of validation.

Static validation

Checks include:

* JavaScript syntax
* linting
* type contracts
* content structure
* quiz references
* offline references
* release identity

Automated testing

Testing includes, where available:

* unit tests
* integration tests
* end-to-end tests
* accessibility tests
* core learner-flow tests
* regression tests

Release validation

The final release should be generated from a clean state and independently verified.

⸻

Deployment

The repository contains the source project and the web application.

For normal web hosting, the deployment target should point to the appropriate generated web application output or site/ directory according to the hosting/deployment configuration.

Do not deploy:

* node_modules/
* coverage/
* playwright-report/
* test-results/
* temporary files
* local development files
* development ZIP archives

Do not manually edit generated release output and then treat it as the source of truth.

⸻

Git Workflow

Recommended basic workflow:

git status
git add .
git commit -m "Initial MYLINGO repository"
git push

For future changes:

git status
git add .
git commit -m "Describe the change"
git push

Keep commits focused and descriptive.

⸻

Important Repository Rules

1. Source files are authoritative

Modify the source project, not generated release output.

2. Keep generated files out of Git

Generated release directories, test reports, coverage reports and temporary files should remain ignored unless a specific release workflow requires them to be stored.

3. Do not upload ZIP archives

The GitHub repository should contain the extracted project structure rather than the original handoff ZIP.

4. Keep secrets out of Git

Never commit:

.env
API keys
passwords
private credentials
tokens

5. Test before release

A successful Git push does not mean that MYLINGO is release-ready.

The release gate must be completed before deployment.

⸻

Development Roadmap

The project should continue to prioritize:

1. Reliable course delivery
2. Reliable quiz delivery
3. Learner progress
4. Offline learning
5. Mobile usability
6. Accessibility
7. Browser compatibility
8. Automated testing
9. Content quality
10. Reproducible releases

⸻

License

Add the project’s final license here before public distribution.

If MYLINGO is not intended to be open source, do not add an open-source license without confirming the intended ownership and distribution model.

⸻

MYLINGO

Interactive English Learning Platform

Build carefully.
Test independently.
Release only verified artifacts.
