# World Scentz Tracking

Painel de rastreamento das importações da World Scentz (perfumes e cosméticos) para o Paraguai: do embarque na origem até o barracão.

> Protótipo de apresentação. Os containers, produtos e marcas exibidos são **dados simulados**.

## O que tem

- **Dashboard** — containers em rota, status, free time e próximas chegadas.
- **Mapa** — rota marítima, hidrovia Paraná–Paraguai e trecho terrestre de cada container.
- **Containers** — lista com filtros, produtos por container, exportação CSV.
- **Barracões** — Assunção e Ciudad del Este: ocupação e estoque recebido.
- **Operação por B/L** — despacho aduaneiro, documentos, custos, conferência de recebimento, registro de alterações.
- **Packing list** — importa planilha do fornecedor (.xlsx / .csv) com marca, produto, volume e quantidade.
- **Relatórios** — custos, demurrage, tempo de trânsito.
- **Integração MSC** — atualização automática de B/Ls reais da MSC.
- **Usuários e permissões** — administrador, despachante, barracão (conferência) e diretoria (consulta).

## Rodar

Requer Node.js 22.5 ou mais novo.

```bash
npm install
npm run demo:seed   # cria os dados simulados (China, Dubai e Miami)
npm run dev         # abre em http://localhost:5317
```

No primeiro acesso a tela pede para criar o usuário administrador.

## Tecnologia

React + TypeScript + Vite no front, Hono + SQLite (embutido no Node) na API. O banco fica em `data/worldscentz.db` e não vai para o repositório.
