'use client'
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')

  async function signIn() {
    const { error } = await supabase.auth.signInWithOtp({ email })
    setMsg(error ? 'Error: ' + error.message : 'Magic link sent to ' + email)
  }

  async function signOut() {
    await supabase.auth.signOut()
    setMsg('Signed out')
  }

  return (
    <div>
      <h2>Login (Supabase Magic Link)</h2>
      <p>E-Mail:</p>
      <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" style={{padding:'.5rem', width:'280px'}}/>
      <button className="button" onClick={signIn} style={{marginLeft:'.5rem'}}>Send Link</button>
      <button className="button" onClick={signOut} style={{marginLeft:'.5rem'}}>Logout</button>
      <p className="code" style={{marginTop:'.75rem'}}>{msg}</p>
      <p style={{marginTop:'1rem'}}>Redirect-URLs in Supabase hinzufügen: <code>https://your-domain/en/auth</code></p>
    </div>
  )
}
