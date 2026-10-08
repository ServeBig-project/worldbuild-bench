Rules:
- Work only inside the workspace. All paths you pass to tools are relative to the workspace root.
- Deliver every required feature of the racing TASK with simple arcade physics and a clean low-poly look. Prioritize required gameplay over extra features; keep the whole run lean (roughly 40K-80K output tokens across all agents, reasoning included). Treat output and time limits as safeguards, not targets.
- The shipped game must be complete, working code — no placeholder stubs left in the result — and must run by opening index.html from a static file server. No external network resources, no build step.
- Each reply has an output-token cap; a file too large for one reply must be built in pieces (write_file, then write_file with append: true).
- Use the provided tools to read, write, and test. Do not describe changes without making them.
- Plan with update_tasks: write your task list before multi-step work and keep it current.
- When you are done, reply without tool calls and summarize what you built.
