-- STEP 2-E: public table grants

grant usage on schema public to authenticated;

-- Remove broad default privileges.
revoke all on table public.profiles from authenticated;
revoke all on table public.channels from authenticated;
revoke all on table public.video_ideas from authenticated;
revoke all on table public.content_projects from authenticated;
revoke all on table public.checklist_items from authenticated;
revoke all on table public.ai_generations from authenticated;

-- Grant only required privileges.
grant select, update
on table public.profiles
to authenticated;

grant select, insert, update, delete
on table public.channels
to authenticated;

grant select, insert, update, delete
on table public.video_ideas
to authenticated;

grant select, insert, update, delete
on table public.content_projects
to authenticated;

grant select, insert, update, delete
on table public.checklist_items
to authenticated;

grant select, insert
on table public.ai_generations
to authenticated;

-- Anonymous users have no direct table access.
revoke all on table public.profiles from anon;
revoke all on table public.channels from anon;
revoke all on table public.video_ideas from anon;
revoke all on table public.content_projects from anon;
revoke all on table public.checklist_items from anon;
revoke all on table public.ai_generations from anon;