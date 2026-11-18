# Hiera — assistant IA indépendant

Hiera est une application indépendante avec sa propre interface et son propre serveur de connexion aux modèles IA de Groq.

## Déploiement Render

Le dépôt contient un fichier `render.yaml` à sa racine. Dans Render, crée un nouveau Blueprint et connecte ce dépôt, puis sélectionne la branche `hiera-independent`. Render utilisera le dossier `hiera-app`, construira l'interface et démarrera le serveur Node.

Après la création du service, ouvre **Environment** dans Render et ajoute les deux variables secrètes :

- `GROQ_API_KEY` : ta clé API Groq.
- `HIERA_ACCESS_PASSWORD` : un code privé que tu choisis et que tu ne partages avec personne.
- `GOOGLE_CLIENT_ID` : l'identifiant client OAuth 2.0 de type application Web créé dans Google Cloud.
- `HIERA_SESSION_SECRET` : une longue valeur aléatoire secrète utilisée pour signer les sessions.

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
GROQ_API_KEY=ta_cle_groq_ici
HIERA_ACCESS_PASSWORD=ton_code_prive
HIERA_API_PORT=3001
```

Démarre Hiera :

```bash
npm run dev
```

Ouvre ensuite http://localhost:5173.

## Connexion Google

Dans Google Cloud Console, configure un client OAuth 2.0 de type application Web et ajoute `https://hiera.onrender.com` aux origines JavaScript autorisées. Copie son identifiant client dans `GOOGLE_CLIENT_ID` sur Render. Le serveur vérifie le jeton d'identité Google avec Google Auth Library puis crée un cookie de session sécurisé. Cette connexion sert à ouvrir une session Hiera ; elle ne donne pas accès à Gmail, Drive ou Agenda.

## Sécurité

- La clé API reste côté serveur et n'est jamais intégrée au code du navigateur.
- Le code d'accès protège l'API sur le déploiement public.
- Le fichier `.env` est ignoré par Git.
- Ne partage ni ta clé API ni ton code privé.
- Les offres et limites de Groq peuvent évoluer. Vérifie les quotas et conditions du compte avant utilisation.

## Fonctionnalités

- Interface de conversation responsive.
- Identité visuelle violette avec atome flottant.
- Appels réels à l'API Groq via le serveur.
- Choix entre les modèles GPT-OSS servis par Groq.
- Connexion à Hiera avec un compte Google (après configuration OAuth sur Render).
- Code privé requis pour utiliser l'API en production.
- Affichage de l'état de génération et des erreurs.

## Architecture

- `src/` : interface React.
- `server/index.mjs` : serveur Node, API et fichiers de l'interface.
- `dist/` : interface compilée lors du déploiement.
- `.env.example` : modèle de configuration, sans secret.
