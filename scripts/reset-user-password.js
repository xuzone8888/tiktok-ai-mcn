/**
 * Reset user password using Supabase Admin API
 * Usage: node scripts/reset-user-password.js
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing Supabase credentials in .env.local');
    console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

// Create admin client with service role key
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function resetPassword() {
    const email = 'xuzone888@outlook.com';
    const newPassword = 'Xu123456';

    console.log(`🔄 Resetting password for: ${email}`);

    try {
        // First, get the user by email
        const { data: users, error: listError } = await supabaseAdmin.auth.admin.listUsers();

        if (listError) {
            throw listError;
        }

        const user = users.users.find(u => u.email === email);

        if (!user) {
            console.error(`❌ User not found: ${email}`);
            process.exit(1);
        }

        console.log(`✅ Found user: ${user.id}`);

        // Update the user's password
        const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
            user.id,
            { password: newPassword }
        );

        if (error) {
            throw error;
        }

        console.log('✅ Password reset successfully!');
        console.log(`📧 Email: ${email}`);
        console.log(`🔑 New Password: ${newPassword}`);

    } catch (error) {
        console.error('❌ Error resetting password:', error.message);
        process.exit(1);
    }
}

resetPassword();
