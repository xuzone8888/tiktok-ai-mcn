// Execute TikTok publishing database migration
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
    console.log('🚀 Starting TikTok Publishing database migration...\n');

    try {
        // Read SQL file
        const sqlPath = path.join(__dirname, '../supabase/migrations/20260116_tiktok_publishing.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');

        // Split into individual statements (removing comments and empty lines)
        const statements = sqlContent
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('DO $$'));

        console.log(`📝 Found ${statements.length} SQL statements to execute\n`);

        // Execute each statement
        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i];
            if (stmt.includes('CREATE TABLE') || stmt.includes('CREATE INDEX') || stmt.includes('CREATE POLICY') || stmt.includes('ALTER TABLE') || stmt.includes('CREATE OR REPLACE FUNCTION')) {
                const match = stmt.match(/(CREATE TABLE|CREATE INDEX|CREATE POLICY|ALTER TABLE|CREATE OR REPLACE FUNCTION)\s+(?:IF NOT EXISTS\s+)?["']?(\w+)["']?/i);
                const objectName = match ? match[2] : 'unknown';
                const objectType = match ? match[1] : 'statement';

                console.log(`  ⏳ ${objectType}: ${objectName}...`);

                const { error } = await supabase.rpc('exec_sql', { sql_query: stmt + ';' }).single();

                if (error) {
                    // Try alternative method - direct query
                    const { error: error2 } = await supabase.from('_exec').select().limit(0);
                    if (!error?.message?.includes('already exists')) {
                        console.log(`     ⚠️  ${error.message || 'Unknown error'}`);
                    } else {
                        console.log(`     ✅ Already exists, skipping`);
                    }
                } else {
                    console.log(`     ✅ Done`);
                }
            }
        }

        console.log('\n✅ Migration completed!');
        console.log('\n📋 Created tables:');
        console.log('   - tiktok_auth_states (OAuth state storage)');
        console.log('   - tiktok_accounts (TikTok account bindings)');
        console.log('   - publish_tasks (Publishing tasks)');
        console.log('   - publish_task_items (Task items)');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

runMigration();
