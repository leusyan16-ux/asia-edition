# Supabase integration boundary

The default demo mode makes no database connection. A server-only public read adapter lives in `src/features/tours/repository.ts`, activated only with `TOUR_DATA_SOURCE=supabase` and isolated test-project configuration. SQL migrations and RLS are in `supabase/migrations`. Admin authentication and writes are separately opt-in; customer storage and payments remain unimplemented. See `docs/INVENTORY.md` before enabling the adapter. Service-role keys must never appear in browser configuration.
# Phase 4: protected administration

The server-only admin adapter lives in `src/features/admin/server.ts`. It uses the current authenticated user's JWT and anon key, verifies `admin_members` on every request, and calls transactional inventory RPCs. No service-role key is used. Apply the separate admin migration and Storage policies in an isolated Supabase project first; see `docs/ADMIN.md`. Local mode is explicitly enabled only for development, stores separate files and never substitutes production persistence.

