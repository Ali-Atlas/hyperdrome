<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:verify-external-assumptions -->
# Verify external assumptions before committing

Before committing or closing a phase, verify every external-system value the work depends on (chain IDs, RPC URLs, library versions and pragmas, third-party API shapes, EVM compatibility features) against current official documentation. Do not trust values from the prompt blindly. Flag anything stale or deprecated before proceeding and report which sources were checked.
<!-- END:verify-external-assumptions -->
