<img src="custom_components/agenda/brand/icon@2x.png" alt="" width="112" align="right">

# Agenda pour Home Assistant

La programmation par calendrier pour Home Assistant, dans l'esprit du plugin Agenda de Jeedom.
Chaque pièce ou appareil a son agenda, présenté comme une semaine que l'on modifie en déplaçant
des blocs.

[![Ouvrir ce dépôt dans HACS sur votre Home Assistant.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=jolabs40&repository=agenda-ha&category=integration)
[![Validate](https://github.com/jolabs40/agenda-ha/actions/workflows/validate.yml/badge.svg)](https://github.com/jolabs40/agenda-ha/actions/workflows/validate.yml)

[English version](README.md) · [Deutsche Version](README.de.md) · [Nederlandse versie](README.nl.md)

![Vue semaine](docs/week.png)

[Voir la présentation de deux minutes sur YouTube](https://youtu.be/GYiXai78Mzg), sous-titrée en neuf langues dont le français.

Un événement fixe ce que font les appareils liés (une température, un mode, marche ou arrêt, la
position d'un volet, une option, une valeur) et peut lancer des actions à son début et à sa fin.
Hors événement, l'agenda revient à son état par défaut.

Les captures sont en anglais ; l'interface s'affiche en français si Home Assistant l'est.

## Fonctions

- Un panneau dans la barre latérale, avec quatre vues :
  - Semaine : un clic sur un créneau vide ajoute un événement, on déplace un bloc en le faisant
    glisser, on l'allonge en tirant son bord bas. Pour un événement répété, on choisit entre ce
    jour seulement et toute la série. Sur un écran tactile, un appui long saisit le bloc. Une
    journée se copie vers d'autres jours de la semaine.
    Un bloc nomme les calendriers dont dépend son événement et entoure celui qui le déclenche ce
    jour-là ; les jours qu'un calendrier retire d'une série apparaissent hachurés.
  - Mois : les événements de chaque jour, avec les jours fériés et les vacances scolaires.
  - Maison : tous les agendas sur une journée, avec ce que fait chaque appareil en ce moment.
  - Liste : tous les événements et leur répétition.
- Sur un grand écran, les agendas sont listés dans une colonne, comme dans le panneau Calendrier :
  on coche ceux à afficher, on voit ce que fait chacun et son prochain changement, on le suspend ou
  on ouvre ses réglages. Sur un téléphone, des pastilles en haut font de même. Le bouton Ajouter un
  événement se trouve en bas à droite.
- Répétition tous les N jours, semaines (jours au choix, ou seulement les semaines paires ou
  impaires) ou mois (même date, 2e lundi, dernier vendredi...), éventuellement jusqu'à une date.
  On peut retirer ou ajouter des jours à une série.
- Le début ou la fin d'un événement peut suivre le lever ou le coucher du soleil, avec un décalage.
- Des conditions sur des entités : un événement ne prend la main que si, par exemple, quelqu'un
  est à la maison ou une fenêtre est fermée.
- Les jours fériés du pays peuvent être sautés, ou être les seuls jours retenus.
- Des calendriers peuvent servir de condition : sauter les jours où ils ont un événement
  (déplacements, absences), ne garder que ceux-là, ou les deux sur le même événement. Avec plusieurs
  calendriers, un événement dans l'un d'eux suffit, ou il en faut un dans chacun.
  Les jours fériés peuvent être l'un de ces calendriers, pour un événement qui tourne les jours de
  télétravail ou les jours fériés.
- Un calendrier des vacances scolaires se choisit une fois pour tous les agendas. Chaque événement
  répété s'applique alors toujours, seulement en période scolaire ou seulement pendant les
  vacances, et la vue Semaine signale les vacances.
- Des actions de début et de fin par événement, avec l'éditeur d'actions habituel de Home Assistant.
- Un mode absence pour toute la maison : les agendas qui le suivent gardent leur état d'absence
  jusqu'à une date, ou jusqu'à ce qu'on l'arrête.
- Pour chaque agenda : une entité `calendar` (panneau Calendrier, déclencheurs de calendrier), un
  interrupteur Actif qui le suspend, les capteurs En ce moment et Prochain changement.
- Des actions pour les automatisations et les assistants vocaux : sauter la prochaine occurrence,
  ajouter ou retirer des dates, démarrer ou terminer le mode absence.
- Les utilisateurs non administrateurs peuvent être autorisés à modifier les événements ; les
  actions de début et de fin restent aux administrateurs.
- Après un redémarrage, les appareils liés sont remis dans l'état prévu (désactivable par agenda).
- Une carte de tableau de bord, `custom:agenda-card`.
- En français, anglais, allemand et néerlandais.

Ce qu'un agenda peut commander :

| Type | Entités | États |
|---|---|---|
| Thermostats | `climate` | température, mode, arrêt |
| Marche / arrêt | `switch`, `light`, `input_boolean`, `fan` | marche (luminosité pour les lampes), arrêt |
| Volets | `cover` | ouvert, fermé, position |
| Sélecteur | `select`, `input_select` | une des options |
| Valeur | `number`, `input_number` | un nombre |
| Rien | | actions seulement |

Pour les thermostats qui publient la température de leurs modes (c'est le cas de Versatile
Thermostat), elle s'affiche à côté du nom du mode.

| Vue Maison | Éditeur d'événement | Téléphone |
|---|---|---|
| ![Vue Maison](docs/house.png) | ![Éditeur](docs/editor.png) | ![Téléphone](docs/mobile.png) |

## Installation

Dans HACS, chercher Agenda (ou utiliser le bouton ci-dessus), le télécharger, puis redémarrer Home
Assistant.

S'il n'apparaît pas encore, l'ajouter en dépôt personnalisé : ouvrir HACS, son menu, Dépôts
personnalisés, et ajouter `https://github.com/jolabs40/agenda-ha` avec le type Intégration.

Sans HACS, décompresser `agenda.zip`, joint à la [dernière version](https://github.com/jolabs40/agenda-ha/releases/latest),
dans un dossier `custom_components/agenda` de la configuration (ou copier ce dossier depuis le
dépôt), puis redémarrer Home Assistant.

Ajouter ensuite l'intégration Agenda depuis Paramètres > Appareils et services. Chaque entrée est un
agenda ; le bouton Nouvel agenda du panneau en crée d'autres. Tout le reste se règle dans le panneau
Agenda.

Home Assistant 2024.7 ou plus récent. Le paquet `holidays` s'installe tout seul. L'icône de
l'intégration s'affiche à partir de Home Assistant 2026.3.

## Quel état s'applique

- L'événement en cours fixe l'état. Hors événement, c'est l'état par défaut de l'agenda. Les
  événements sans état (rappels, actions seulement) ne comptent pas ici.
- Quand des événements se chevauchent, celui qui a commencé le plus tard l'emporte, et le plus
  court à égalité. Un Week-end sur toute la journée et une Nuit qui commence à minuit : la nuit
  l'emporte jusqu'à sa fin, puis le week-end reprend.
- À chaque changement, les actions de fin passent d'abord, puis l'état, puis les actions de début.
  Les thermostats reçoivent leur consigne au début de chaque événement : un réglage manuel tient
  jusqu'à l'événement suivant. Les autres appareils ne sont appelés que si leur état diffère.
- Les heures sont celles de l'horloge : un événement à 21h30 reste à 21h30 au changement d'heure.
- Couper l'interrupteur Actif suspend complètement l'agenda.

## Actions

Les actions fonctionnent comme dans les automatisations, avec trois variables en plus :

| Variable | Contenu |
|---|---|
| `agenda` | nom de l'agenda |
| `phase` | `start` ou `end` |
| `event` | `id`, `name`, `start`, `end` (dates ISO) |

```yaml
- action: notify.mobile_app_telephone
  data:
    message: "{{ event.name }} ({{ agenda }}) {{ 'commence' if phase == 'start' else 'se termine' }}"
```

Seuls les administrateurs règlent les actions. Les utilisateurs autorisés à modifier les
événements ne les voient pas, et leurs modifications gardent les actions en place.

## Lever, coucher du soleil et conditions

Les heures du soleil sont calculées par Home Assistant, jour par jour, pour l'emplacement réglé
dans Paramètres > Système > Général. Quand le soleil fait passer la fin d'un événement avant son
début (coucher après une fin fixée à 21:00 en été), l'événement n'a pas lieu ce jour-là.

Les conditions comparent l'état d'une entité : `person.alex` est `home`, `binary_sensor.fenetre`
n'est pas `on`. Elles sont lues au début de l'événement et à chaque changement de l'entité. Un
événement dont les conditions ne sont plus remplies laisse la main à l'événement suivant, ou à
l'état par défaut ; ses actions de fin s'exécutent quand même.

## Mode absence

Le bouton en haut du panneau le démarre, jusqu'à une date ou jusqu'à ce qu'on l'arrête ; les
actions `agenda.set_absence` et `agenda.end_absence` font de même depuis une automatisation.
Pendant ce temps, chaque agenda qui le suit (une option de ses réglages) garde son état d'absence,
ou à défaut son état par défaut, et ne lance aucune action. À la fin, chaque agenda reprend son
programme.

## Automatisations

| Action | Cible | Données |
|---|---|---|
| `agenda.skip_next` | le calendrier d'un agenda | `event` (nom, facultatif) : retire la prochaine occurrence |
| `agenda.add_dates` | le calendrier d'un agenda | `event`, `dates` : ajoute des occurrences ces jours-là |
| `agenda.remove_dates` | le calendrier d'un agenda | `event`, `dates` : retire les occurrences ces jours-là |
| `agenda.set_absence` | | `until` (facultatif) : démarre le mode absence |
| `agenda.end_absence` | | le termine |
| `agenda.resync` | le calendrier d'un agenda | remet les appareils dans l'état voulu maintenant |

```yaml
- action: agenda.skip_next
  target:
    entity_id: calendar.agenda_sejour
  data:
    event: Matin
```

## Jours fériés

Ils suivent le pays réglé dans Paramètres > Système > Général. Un autre pays, ou une région
(Alsace-Moselle, outre-mer...), se choisit dans les réglages de n'importe quel agenda et vaut pour
tous.

Dans les exceptions d'un événement, Jours fériés figure aussi en tête des listes de calendriers.
Le réglage Jours fériés restreint toujours les jours, alors qu'une liste combine ses calendriers :
avec Télétravail et Jours fériés sous Seulement les jours avec un événement (dans au moins l'un
d'eux, le choix par défaut), l'événement tourne les jours de télétravail comme les jours fériés.

## Vacances scolaires

Ajouter un calendrier des vacances, par exemple avec l'intégration Remote Calendar et le
calendrier officiel de sa zone, puis le choisir dans les réglages communs de n'importe quel
agenda. Le ministère en publie un par zone :
`https://fr.ftp.opendatasoft.com/openscol/fr-en-calendrier-scolaire/Zone-A.ics` (ou `Zone-B`,
`Zone-C`, `Corse`).

Pour un enfant interne la semaine, par exemple : marquer ses plages de semaine en Période
scolaire, et ajouter un événement d'une journée entière, tous les jours, à la température de la
maison, marqué Vacances scolaires.

## Carte de tableau de bord

```yaml
type: custom:agenda-card
view: house                 # tous les agendas, aujourd'hui
agendas: [Chambre, Salon]   # filtre facultatif
title: Chauffage            # facultatif
```

```yaml
type: custom:agenda-card
view: week
agenda: Chambre
```

Un clic sur la carte ouvre le panneau.

## Soutenir le projet

Agenda est gratuit. S'il vous rend service, vous pouvez m'offrir un café sur [Ko-fi](https://ko-fi.com/jolabs40).

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/jolabs40)

Une étoile sur ce dépôt aide aussi d'autres personnes à le trouver.

## Licence

[MIT](LICENSE)
