'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { clearAuthIntent, readAuthIntent } from '@/lib/authIntent';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [entitlements, setEntitlements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [lastIntent, setLastIntent] = useState(null);

  async function loadProfileAndEntitlements(userId) {
    if (!userId) {
      setProfile(null);
      setEntitlements([]);
      return;
    }

    const [{ data: profileData }, { data: entData }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase
        .from('user_entitlements')
        .select('*')
        .eq('user_id', userId)
        .or('valid_to.is.null,valid_to.gt.now()'),
    ]);

    setProfile(profileData || null);
    setEntitlements(entData || []);
  }

    useEffect(() => {
    let active = true;

    async function boot() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;

      const currentSession = data.session ?? null;
      const currentUser = currentSession?.user ?? null;

      setSession(currentSession);
      setUser(currentUser);

      if (currentUser?.id) {
        await loadProfileAndEntitlements(currentUser.id);
      } else {
        setProfile(null);
        setEntitlements([]);
      }

      const intent = readAuthIntent();
      if (intent) {
        setLastIntent(intent);
        clearAuthIntent();
      }

      setLoading(false);
    }

    boot();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      const newUser = newSession?.user ?? null;

      setSession(newSession ?? null);
      setUser(newUser);

      if (newUser?.id) {
        await loadProfileAndEntitlements(newUser.id);

        const intent = readAuthIntent();
        if (intent) {
          setLastIntent(intent);
          clearAuthIntent();
        }
      } else {
        setProfile(null);
        setEntitlements([]);
      }

      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
 
  async function signOut() {
    await supabase.auth.signOut();
    setAuthModalOpen(false);
  }

  const value = useMemo(
    () => ({
      user,
      session,
      profile,
      entitlements,
      loading,
      authModalOpen,
      setAuthModalOpen,
      signOut,
      lastIntent,
      setLastIntent,
    }),
    [user, session, profile, entitlements, loading, authModalOpen, lastIntent]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}