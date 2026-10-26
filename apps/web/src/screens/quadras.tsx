import { useState } from 'react';
import { useRuntime } from '../data/runtime.tsx';
import { uuid } from '../lib/format.ts';
import { Button, Empty, Field, PageHead } from '../ui/kit.tsx';

export function QuadrasScreen() {
  const { state, run } = useRuntime();
  const [name, setName] = useState('');
  const courts = Object.values(state.courts).sort((a, b) => a.order - b.order);
  return (
    <>
      <PageHead title="Quadras" />
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; void run({ type: 'court.save', payload: { court: { id: uuid(), name: name.trim() } } }, 'Quadra adicionada.').then(() => setName('')); }}>
        <Field label="Nome da nova quadra">{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Quadra 1" />}</Field>
        <Button type="submit" variant="primary" icon="plus">Adicionar quadra</Button>
      </form>
      {courts.length === 0 ? <Empty title="Nenhuma quadra cadastrada">Cadastre ao menos uma para montar a agenda.</Empty> : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, marginTop: '1rem' }}>
          {courts.map((c) => (
            <li className="card row" key={c.id}>
              <span className="grow">{c.name}</span>
              <Button size="sm" variant="danger" icon="x" label={`Remover ${c.name}`} onClick={() => void run({ type: 'court.delete', payload: { courtId: c.id } }, 'Quadra removida.')}>Remover</Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
