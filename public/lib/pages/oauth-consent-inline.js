    // Apply saved theme before first paint to avoid flash
    (function () {
      const saved = localStorage.getItem('wh_theme');
      const dark  = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme:dark)').matches;
      if (dark) {
        document.documentElement.classList.add('dark');
        document.getElementById('favicon').href = '/icons/favicon-dark.svg';
      }
    })();

    // ── Supabase config — credentials loaded from lib/config.js (see <script> above) ──
    const SUPABASE_URL      = window.__SB_URL;
    const SUPABASE_ANON_KEY = window.__SB_ANON_KEY;
    const SDK_CDN           = '/lib/supabase.umd.js';

    function showError(text) {
      document.getElementById('spinner').style.display = 'none';
      const el = document.getElementById('msg');
      el.className  = 'err';
      el.textContent = text;
      // Redirect back to login after a short pause so the user sees the message
      setTimeout(() => {
        window.location.replace('/login.html?error=oauth_failed');
      }, 3000);
    }

    async function main() {
      // Supabase appends the auth code as ?code= to this page's URL
      const params = new URLSearchParams(window.location.search);
      const code   = params.get('code');

      // Provider may also return an error instead of a code
      if (!code) {
        const errDesc = params.get('error_description') || params.get('error');
        showError(errDesc ? decodeURIComponent(errDesc) : 'Sign-in was cancelled.');
        return;
      }

      // Dynamically load the Supabase JS SDK (no build step required)
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src    = SDK_CDN;
        script.onload  = resolve;
        script.onerror = () => reject(new Error('Failed to load Supabase SDK'));
        document.head.appendChild(script);
      });

      // Initialise client — detectSessionInUrl:false because we handle it manually
      const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession:     true,
          autoRefreshToken:   true,
          detectSessionInUrl: false,
        },
      });

      // Exchange the PKCE authorisation code for a real session
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (error || !data?.session) {
        console.error('[oauth/consent] exchangeCodeForSession failed:', error);
        showError('Sign-in failed. Sending you back to the login page…');
        return;
      }

      // All good — go to the app
      window.location.replace('/');
    }

    main().catch(err => {
      console.error('[oauth/consent] Unexpected error:', err);
      showError('Something went wrong. Redirecting…');
    });
  
