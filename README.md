# SUPIDO

SUPIDO est un gestionnaire de téléchargements vidéo original, écrit en Node.js. Il fournit une file d'attente persistante, la reprise des transferts, une progression en direct, un historique avec retéléchargement, une interface web locale et une extension Chrome.

Le nom vient de « speed » prononcé à la japonaise. La signature éclair reprend cette idée.

SUPIDO est développé de façon indépendante. Le moteur repose sur yt-dlp et ffmpeg, sans code ni ressource propriétaire incluse.

## Prérequis

- Node.js 20 ou supérieur
- yt-dlp pour les sites vidéo et les flux HLS
- ffmpeg pour fusionner les pistes vidéo et audio
- un accès local au port `8787`

Aucune dépendance npm n'est à installer. Le projet n'utilise que les modules intégrés à Node.js.

Vérifier l'environnement :

```bash
node -v
supido doctor
```

La commande `supido doctor` doit afficher le chemin de yt-dlp, sa version et le dossier de téléchargement accessible.

## Installation

### 1. Dossier du projet

Placer le projet dans le dossier de votre choix, par exemple `~/supido`. Toutes les commandes suivantes partent de ce dossier :

```bash
cd ~/supido
```

Adapter ce chemin selon votre installation.

### 2. Commande globale `supido`

Créer le wrapper `~/.local/bin/supido` avec ce contenu :

```bash
#!/bin/sh
exec node "$HOME/supido/bin/supido.js" "$@"
```

Remplacer `$HOME/supido` par le chemin réel du projet si nécessaire. Puis rendre le wrapper exécutable :

```bash
chmod +x ~/.local/bin/supido
```

Si `~/.local/bin` n'est pas dans le PATH, ajouter cette ligne au fichier `~/.bashrc` :

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Puis recharger le shell :

```bash
source ~/.bashrc
```

Sans wrapper, toutes les commandes fonctionnent aussi avec `node bin/supido.js`.

### 3. Binaires de téléchargement

Placer yt-dlp et ffmpeg dans `~/.local/bin` :

```bash
~/.local/bin/yt-dlp
~/.local/bin/ffmpeg
```

Puis les rendre exécutables :

```bash
chmod +x ~/.local/bin/yt-dlp ~/.local/bin/ffmpeg
```

Vérifier :

```bash
yt-dlp --version
ffmpeg -version | head -1
```

SUPIDO détecte automatiquement `~/.local/bin/yt-dlp`. Il est possible de forcer un autre binaire avec la clé `ytDlpPath` de la configuration.

## Démarrage et arrêt

```bash
supido start          # démarrer en arrière-plan
supido stop           # arrêt propre
supido restart        # redémarrage propre
supido serve          # premier plan, utile pour voir les logs
supido status         # état du serveur
```

Utiliser toujours `supido stop` ou `supido restart`. Un arrêt brutal peut laisser des connexions Server-Sent Events ouvertes et bloquer le port sous WSL2.

Le serveur écoute sur `http://localhost:8787`. Il répond aussi sur `http://127.0.0.1:8787`.

Vérification rapide :

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/state
```

La réponse attendue est `200`.

## Interface web

Ouvrir :

```bash
http://localhost:8787
```

L'interface permet de :

- coller une URL de site vidéo, de lecteur intégré ou de fichier direct ;
- choisir le moteur, le mode `Auto` détecte automatiquement le bon traitement ;
- suivre la file d'attente avec progression, vitesse et temps restant ;
- mettre en pause, reprendre, annuler, réessayer ou supprimer une tâche ;
- retrouver les terminés dans l'historique, avec date, taille, nom de fichier et présence du fichier ;
- retélécharger un élément de l'historique, même après perte du fichier ;
- modifier le dossier de sortie, le format, la concurrence, le port, la limite de vitesse et les notifications.

Toutes les icônes sont des SVG Iconify Phosphor Duotone embarqués localement dans `web/icons.js`. Aucune police d'icônes, aucun SVG inline et aucun glyphe texte ne sont utilisés dans l'interface.

## Utilisation rapide

Ajouter une tâche depuis le terminal :

```bash
node bin/supido.js add "https://www.youtube.com/watch?v=ID"
node bin/supido.js add "https://exemple.fr/film.mp4" --type=direct
node bin/supido.js list
node bin/supido.js history
```

Ajouter depuis l'interface web :

1. Ouvrir `http://localhost:8787`.
2. Coller l'URL dans la barre.
3. Laisser `Auto` ou choisir `Site vidéo` ou `Fichier direct`.
4. Cliquer sur `Ajouter`.
5. Suivre la tâche dans `Ma file`.

Le format par défaut est `bv*+ba/b`. Il télécharge la meilleure vidéo et le meilleur audio, puis les fusionne avec ffmpeg. Cela couvre YouTube et de nombreux sites qui ne proposent plus de fichier progressif. Sur un flux HLS, yt-dlp reçoit un seul format MP4 et aucune fusion n'est nécessaire.

## Configuration

Les réglages sont dans `data/config.json` et modifiables depuis l'interface web.

| Clé | Valeur par défaut | Rôle |
|---|---|---|
| `downloadDir` | `data/downloads` | dossier de sortie, relatif au projet |
| `ytDlpPath` | `yt-dlp` | binaire yt-dlp, résolu automatiquement dans `~/.local/bin` |
| `format` | `bv*+ba/b` | sélection des formats |
| `concurrency` | `2` | nombre de téléchargements simultanés |
| `port` | `8787` | port du serveur local |
| `speedLimitKiB` | `0` | limite de vitesse, `0` signifie illimité |
| `notifications` | `true` | notification à la fin d'un transfert |
| `historyLimit` | `200` | nombre d'entrées conservées dans l'historique |

Modifier une valeur depuis le terminal :

```bash
node bin/supido.js config concurrency 4
```

Modifier le port impose un redémarrage du serveur.

## Extension Chrome

Le dossier `extension/` contient une extension Manifest V3. Elle utilise le même jeu d'icônes que l'interface web, embarqué dans `extension/icons.js`.

Installation :

1. Ouvrir `chrome://extensions`.
2. Activer le mode développeur.
3. Cliquer sur `Charger l'extension non empaquetée`.
4. Sélectionner le dossier `extension/`.
5. Laisser le serveur SUPIDO tourner.
6. Cliquer sur l'icône SUPIDO dans Chrome.

Après chaque modification des fichiers de l'extension, cliquer sur le bouton de rechargement dans `chrome://extensions`.

L'extension analyse la page et toutes ses frames. Elle détecte les lecteurs `video` et `source`, les attributs `data-*`, les liens vers fichiers, les flux `.m3u8` et `.mpd`, les URLs dans le code source, les iframes et les lecteurs embarqués. Quand le lecteur cache son flux derrière un `blob:` ou un JavaScript, l'extension envoie l'URL de la page et le serveur retrouve le flux HLS avec `src/resolve.js`.

L'adresse du serveur local est réglable dans les options de l'extension. Le défaut est `http://localhost:8787`. Le popup essaie automatiquement `127.0.0.1` si `localhost` ne répond pas.

Le serveur accepte les appels depuis les origines `chrome-extension://` et `localhost`. L'extension ne télécharge rien elle-même, elle transmet seulement des URLs au moteur local.

## Données et sauvegarde

Les données sont dans `data/` :

- `config.json`, configuration persistante ;
- `queue.json`, file d'attente ;
- `history.json`, historique ;
- `downloads/`, fichiers terminés.

Le dossier `data/downloads/` est exclu du dépôt via `.gitignore`. Seuls les fichiers de configuration et d'état sont suivis.

La variable d'environnement `SUPIDO_HOME` permet de déplacer ce dossier :

```bash
SUPIDO_HOME=/chemin/personnalisé supido start
```

Pour sauvegarder l'application, copier le dossier du projet et le dossier de données. Les fichiers vidéo restent sur la machine, aucun service distant ne les reçoit.

## Dépannage

### Le serveur ne répond pas

```bash
supido restart
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/state
```

Si le code reste `000`, vérifier le port :

```bash
ss -ltnp | grep 8787
```

### Le port est déjà occupé

Arrêter proprement le serveur, puis relancer :

```bash
supido stop
supido start
```

Éviter un `kill` direct sur le processus Node, notamment sous WSL2.

### Une vidéo n'est pas reconnue

Mettre à jour yt-dlp :

```bash
yt-dlp -U
supido restart
```

Certains sites exigent des cookies, une connexion ou des fonctionnalités d'impersonation. SUPIDO ne contourne pas ces protections.

### Le téléchargement reste à zéro

Vérifier la version de yt-dlp et le format configuré. Le format `bv*+ba/b` est recommandé. Sur les flux HLS, la taille totale est une estimation, donc la barre peut avancer par paliers. Elle ne recule pas.

## Limites connues

- Aucune authentification sur l'interface web, qui n'écoute que sur la machine locale.
- La reprise HTTP dépend du serveur distant. Sans gestion de l'en-tête `Range`, le transfert repart du début.
- Les contenus protégés par DRM, identifiants ou flux chiffrés dépendent des capacités de yt-dlp.
- L'extension ne démarre pas le serveur, qui doit déjà être lancé.
- Aucune planification horaire pour l'instant.

## À propos

SUPIDO est une création indépendante. Aucun binaire tiers n'est fourni avec le projet. Les téléchargements sont effectués par les outils installés sur votre machine.
