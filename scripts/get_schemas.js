require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
    // Use rpc to run raw SQL on public schema
    const { data, error } = await s.rpc('exec_sql', {
        query: `SELECT table_name, column_name, data_type, is_nullable, column_default 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            ORDER BY table_name, ordinal_position`
    });

    if (error) {
        // Fallback: query each table individually  
        const tables = [
            'profiles', 'users', 'ai_models', 'products', 'contracts',
            'generations', 'credit_transactions', 'projects', 'task_queue',
            'credit_pricing', 'system_settings', 'tiktok_accounts', 'publish_tasks',
            'publish_task_items', 'link_video_jobs', 'product_links',
            'templates', 'audit_logs', 'quick_gen_history'
        ];

        const lines = [];
        for (const t of tables) {
            try {
                // Use select with limit 0 + head to get column info, then select 1 row for types
                const { data: rows, error: e } = await s.from(t).select('*').limit(1);
                if (e) {
                    lines.push(`## ${t}: NOT_FOUND`);
                    continue;
                }
                lines.push(`## ${t}`);
                if (rows && rows[0]) {
                    for (const [col, val] of Object.entries(rows[0])) {
                        let tsType = 'unknown';
                        if (val === null) tsType = 'nullable';
                        else if (typeof val === 'boolean') tsType = 'boolean';
                        else if (typeof val === 'number') tsType = 'number';
                        else if (typeof val === 'string') {
                            // Check if it looks like a UUID, date, etc.
                            if (/^\d{4}-\d{2}-\d{2}/.test(val)) tsType = 'string (datetime)';
                            else if (/^[0-9a-f]{8}-/.test(val)) tsType = 'string (uuid)';
                            else tsType = 'string';
                        }
                        else if (Array.isArray(val)) tsType = 'Json[] (array)';
                        else tsType = 'Json (object)';
                        lines.push(`  ${col}: ${tsType} = ${JSON.stringify(val).slice(0, 80)}`);
                    }
                } else {
                    // Table exists but empty, try to get column names from error
                    const { error: e2 } = await s.from(t).select('*').limit(0);
                    lines.push(`  (empty table - no sample data)`);
                }
                lines.push('');
            } catch (ex) {
                lines.push(`## ${t}: ERROR ${ex.message}`);
            }
        }
        fs.writeFileSync('schema_output.txt', lines.join('\n'), 'utf8');
        console.log('DONE - wrote schema_output.txt');
    } else {
        fs.writeFileSync('schema_output.txt', JSON.stringify(data, null, 2), 'utf8');
        console.log('DONE via SQL');
    }
    process.exit(0);
})();
