import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()
        const url = new URL(request.url)
        const type = url.searchParams.get('type')

        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let query = supabase
            .from('creative_templates')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })

        if (type) {
            query = query.eq('type', type)
        }

        const { data, error } = await query

        if (error) {
            console.error('Fetch templates error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ data })
    } catch (error) {
        console.error('Internal server error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const json = await request.json()
        const { name, description, type, config } = json

        if (!name || !type || !config) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const { data, error } = await supabase
            .from('creative_templates')
            .insert({
                user_id: user.id,
                name,
                description,
                type,
                config
            } as any)
            .select()
            .single()

        if (error) {
            console.error('Create template error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ data })
    } catch (error) {
        console.error('Internal server error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
