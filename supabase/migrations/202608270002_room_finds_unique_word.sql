create unique index if not exists room_finds_word_unique
  on public.room_finds(room_id, word);
