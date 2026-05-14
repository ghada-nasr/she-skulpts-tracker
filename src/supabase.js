import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://hosubwiuhkbpntjgxnms.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhvc3Vid2l1aGticG50amd4bm1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3Mzg3MDMsImV4cCI6MjA5NDMxNDcwM30.DjCHGg7l0RXPZpaK9oQtPh7SmCYNhE-D_MjJs-IXNNo'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
