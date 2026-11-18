# Hiera — application indépendante

Hiera est un nouveau projet d'assistant IA avec une identité visuelle et une interface originales.

## Démarrer en local

Prérequis : Node.js 20+ et npm.

```bash
cd hiera-app
npm install
npm run dev
```

Puis ouvrir l'adresse locale affichée par Vite.

## État actuel

- Interface de conversation responsive.
- Identité visuelle violette et atome flottant animé visuellement (prototype statique).
- Saisie et affichage local des messages.
- Aucune réponse IA fictive : le raccordement à un fournisseur sera ajouté dans une étape séparée.

## Architecture prévue

- `src/` : interface React.
- `server/` (à créer) : futur serveur sécurisé pour les appels aux fournisseurs IA.
- Les clés API devront rester côté serveur ou dans un stockage sécurisé, jamais dans le code public du navigateur.

Ce dossier est développé indépendamment et ne réutilise pas les composants internes de LobeHub.