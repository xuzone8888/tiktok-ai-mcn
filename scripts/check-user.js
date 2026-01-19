const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
    // First find user by email
    const { data: user, error: userErr } = await supabase
        .from('profiles')
        .select('id, email, credits')
        .eq('email', '616551799@qq.com')
        .single();

    if (userErr) {
        console.log('User error:', userErr.message);
        return;
    }

    console.log('=== User Info ===');
    console.log('ID:', user.id);
    console.log('Email:', user.email);
    console.log('Credits:', user.credits);

    // Get their generations
    const { data: gens, error: genErr } = await supabase
        .from('generations')
        .select('id, task_id, status, error_message, credit_cost, created_at, model, duration')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

    if (genErr) {
        console.log('Gen error:', genErr.message);
        return;
    }

    console.log('\n=== Recent Generations (last 20) ===');

    let completed = 0, failed = 0, pending = 0;

    gens.forEach((g, i) => {
        if (g.status === 'completed') completed++;
        else if (g.status === 'failed') failed++;
        else pending++;

        console.log(`${i + 1}. [${g.status}] ${g.model || 'unknown'} ${g.duration || '?'}s - ${g.created_at}`);
        if (g.error_message) console.log(`   Error: ${g.error_message}`);
    });

    console.log('\n=== Summary ===');
    console.log('Completed:', completed);
    console.log('Failed:', failed);
    console.log('Pending:', pending);
}

check().catch(console.error);
