# Local-First Data And Privacy

WorldArchitect is designed as a local-first desktop-style web app. You run it yourself, and the project data lives on your machine.

## What Is Stored Locally

World data is stored in a local SQLite database managed by the server process. This includes:

- Worlds
- Categories
- Articles
- Article versions
- World Bible summaries
- Snapshots
- Pending drafts
- Provider settings
- Call logs
- Issues and warnings

The app does not require accounts or hosted cloud storage.

## What Uses The Network

Normal editing, browsing, versioning, snapshots, and export do not require an LLM provider.

Network calls happen only when you configure a provider and run an AI-powered tool. Depending on your provider, the app may send relevant prompts, article summaries, context, and draft content to that provider.

## API Keys

Provider keys are stored locally by the app. They are masked when returned to the client interface.

You should still treat your local database and environment as sensitive, because provider credentials and private world material may be present on your machine.

## Export

WorldArchitect can export a world as a ZIP of Markdown files. This gives you a portable copy that can be backed up, versioned elsewhere, or read without the app.

## Practical Privacy Model

WorldArchitect is a good fit if you want:

- No account system
- Local persistence
- Optional AI instead of mandatory AI
- Control over when world content leaves your machine
- A straightforward path to export your work

It is not a hosted collaboration platform, and it does not provide built-in cloud sync.
