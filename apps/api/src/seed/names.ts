// Dados 100% fictícios para testes. Nomes sorteados de listas comuns; telefones usam DDD "00" (inexistente).
import { mulberry32 } from '@playtorneios/domain';
import type { Rng } from '@playtorneios/domain';

const MALE = ['Renato', 'Thiago', 'Lucas', 'Gabriel', 'Mateus', 'Rafael', 'Bruno', 'Felipe', 'Diego', 'André', 'Caio', 'Vinícius', 'Leandro', 'Rodrigo', 'Henrique', 'Eduardo', 'Marcelo', 'Fábio', 'Gustavo', 'Otávio', 'Pedro', 'Davi', 'Samuel', 'Igor', 'Murilo', 'Danilo', 'Alan', 'Wesley', 'Jonas', 'Cauã'];
const FEMALE = ['Camila', 'Bia', 'Larissa', 'Juliana', 'Fernanda', 'Mariana', 'Amanda', 'Letícia', 'Carolina', 'Patrícia', 'Aline', 'Renata', 'Bruna', 'Tatiana', 'Gabriela', 'Priscila', 'Débora', 'Vanessa', 'Natália', 'Isabela', 'Luana', 'Rafaela', 'Michele', 'Sabrina', 'Thaís', 'Jéssica', 'Helena', 'Clara', 'Lívia', 'Paula'];
const SURNAME = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Lima', 'Pereira', 'Ferreira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento', 'Araújo', 'Ribeiro', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Barbosa', 'Moreira', 'Cardoso', 'Teixeira', 'Cavalcanti', 'Dias', 'Castro', 'Campos', 'Freitas', 'Monteiro', 'Mendes', 'Barros', 'Pinto', 'Duarte', 'Farias'];
const CITIES = ['Natal', 'Fortaleza', 'Recife', 'Florianópolis', 'Santos', 'Salvador', 'Maceió', 'João Pessoa', 'Rio de Janeiro', 'Vitória', 'Balneário Camboriú', 'Guarujá'];

export type Sex = 'male' | 'female';

export interface FakeAthlete {
  fullName: string;
  gender: Sex;
  birthDate: string;
  city: string;
  phone: string;
}

/** Gerador de atletas únicos (nome completo não se repete dentro de uma mesma instância). */
export function athleteFactory(seed: number) {
  const rng: Rng = mulberry32(seed);
  const used = new Set<string>();
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)] as T;
  return {
    rng,
    next(gender: Sex): FakeAthlete {
      let name = '';
      for (let i = 0; i < 200; i++) {
        name = `${pick(gender === 'male' ? MALE : FEMALE)} ${pick(SURNAME)} ${pick(SURNAME)}`;
        if (!used.has(name)) break;
      }
      if (used.has(name)) name = `${name} ${used.size + 1}`;
      used.add(name);
      const year = 1979 + Math.floor(rng() * 26); // 18–47 anos em 2026
      const month = 1 + Math.floor(rng() * 12);
      const day = 1 + Math.floor(rng() * 28);
      const pad = (n: number) => String(n).padStart(2, '0');
      return {
        fullName: name,
        gender,
        birthDate: `${year}-${pad(month)}-${pad(day)}`,
        city: pick(CITIES),
        phone: `(00) 90000-${String(Math.floor(rng() * 10000)).padStart(4, '0')}`,
      };
    },
  };
}
