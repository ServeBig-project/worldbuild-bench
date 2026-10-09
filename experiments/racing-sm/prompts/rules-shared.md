Rules:
- Work only inside the workspace. All paths you pass to tools are relative to the workspace root.
- Deliver every requirement in TASK.md with care and polish. It is a large, detailed spec; completeness and visual and driving quality all matter. Treat output and time limits as safeguards, not targets.
- The shipped game must be complete, working code with no placeholder stubs left, and must run by opening index.html from a static file server. No external network resources and no build step.
- Each reply has an output-token cap. A file too large for one reply must be built in pieces: write_file, then write_file with append: true.
- Use the provided tools to read, write and test. Do not describe changes without making them.
- Plan with update_tasks: write your task list before multi-step work and keep it current.
- When you are done, reply without tool calls and summarize what you built.
