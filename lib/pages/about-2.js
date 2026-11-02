    if (/Windows NT/.test(navigator.userAgent) && matchMedia('(pointer: fine)').matches)
      document.documentElement.classList.add('is-win-pc');
    if (document.documentElement.classList.contains('dark')) {
      document.getElementById('logo').src = '/brand-dark.svg';
      document.getElementById('favicon').href = '/favicon-dark.svg';
    }
  
