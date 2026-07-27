// Publik konfiguration. Anon-nyckeln är avsedd att exponeras och skyddas av RLS –
// service-nyckeln får ALDRIG hamna här.
export const SUPABASE_URL = 'https://mggzoqrpunxmayvlayvr.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1nZ3pvcXJwdW54bWF5dmxheXZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwODAxNjEsImV4cCI6MjEwMDY1NjE2MX0.YqKGVZ6xu7wS_eh0QJn0iN9GBbERNhExdvU6u5G9Y4E';

// Antal recept som hämtas per sidladdning.
export const PAGE_SIZE = 100;
