import { useState } from 'react';
import { api, HttpError } from '../data/http-transport.ts';
import { Button, Field } from '../ui/kit.tsx';

export function LoginScreen(props: { onDone: () => void; expired?: boolean }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [org, setOrg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      if (mode === 'signup') await api.post('/api/auth/signup', { email, password, organizationName: org });
      await api.post('/api/auth/login', { email, password });
      props.onDone();
    } catch (e) {
      setError(e instanceof HttpError ? e.message : 'Sem conexão com o servidor. Verifique a internet e tente de novo.');
    } finally { setBusy(false); }
  };
  return (
    <main id="conteudo" style={{ margin: '0 auto', maxWidth: '28rem' }}>
      <h1>{mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>
      {props.expired && <p className="banner" role="status">Sua sessão expirou. Entre de novo para sincronizar. O que você fez neste aparelho continua salvo.</p>}
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="E-mail">{(p) => <input {...p} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Senha" hint={mode === 'signup' ? 'Pelo menos 10 caracteres.' : undefined}>{(p) => <input {...p} type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        {mode === 'signup' && <Field label="Nome da organização">{(p) => <input {...p} value={org} onChange={(e) => setOrg(e.target.value)} required />}</Field>}
        {error && <p className="error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={busy}>{mode === 'login' ? 'Entrar' : 'Criar conta e entrar'}</Button>
        <Button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>{mode === 'login' ? 'Criar uma conta' : 'Já tenho conta'}</Button>
      </form>
    </main>
  );
}
