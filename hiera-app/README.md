# Hiera — assistant IA indépendant

Hiera est une application indépendante avec sa propre interface et son propre serveur de connexion aux modèles IA.

## Déploiement Render

Le dépôt contient un fichier `render.yaml` à sa racine. Dans Render, crée un nouveau Blueprint et connecte ce dépôt, puis sélectionne la branche `hiera-independent`. Render utilisera le dossier `hiera-app`, construira l'interface et démarrera le serveur Node.

Après la création du service, ouvre **Environment** dans Render et ajoute les deux variables secrètes :

- `Key_API_Hiera` : ta clé API OpenAI.
- `HIERA_ACCESS_PASSWORD` : un code privé que tu choisis et que tu ne partages avec personne.

Ne colle jamais ces valeurs dans GitHub, dans le code du projet ou dans cette conversation. Dans l'interface Hiera hébergée, saisis le code privé dans le champ « Code privé » avant d'envoyer un message.

Le serveur écoute automatiquement sur le port fourni par Render et sert à la fois l'interface construite et l'API. Le contrôle d'accès protège les appels à l'API en production.

## Installation locale

Prérequis : Node.js 20 ou plus récent et npm.

Depuis le dossier `hiera-app` :

```bash
npm install
```

Copie `.env.example` vers `.env`, puis renseigne les valeurs localement :

```env
Key_API_Hiera=ta_cle_api_ici
HIERA_ACCESS_PASSWORD=ton_code_prive
HIERA_API_PORT=3001
```

Démarre Hiera :

```bash
npm run dev
```

Ouvre ensuite http://localhost:5173.

## Sécurité

- La clé API reste côté serveur et n'est jamais intégrée au code du navigateur.
- Le code d'accès protège l'API sur le déploiement public.
- Le fichier `.env` est ignoré par Git.
- Ne partage ni ta clé API ni ton code privé.
- L'utilisation de l'API OpenAI peut entraîner des frais selon ton compte et ton utilisation. Vérifie les limites et la facturation avec un parent ou responsable.

## Fonctionnalités

- Interface de conversation responsive.
- Identité visuelle violette avec atome flottant.
- Appels réels à l'API OpenAI via le serveur.
- Choix entre GPT-4.1 mini et GPT-4.1.
- Code privé requis pour utiliser l'API en production.
- Affichage de l'état de génération et des erreurs.

## Architecture

- `src/` : interface React.
- `server/index.mjs` : serveur Node, API et fichiers de l'interface.
- `dist/` : interface compilée lors du déploiement.
- `.env.example` : modèle de configuration, sans secret.
