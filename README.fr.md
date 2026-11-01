<img src="custom_components/agenda/brand/icon@2x.png" alt="" width="112" align="right">

# Agenda pour Home Assistant

La programmation par calendrier pour Home Assistant, dans l'esprit du plugin Agenda de Jeedom.
Chaque pièce ou appareil a son agenda, présenté comme une semaine que l'on modifie en déplaçant
des blocs.

[![Ouvrir ce dépôt dans HACS sur votre Home Assistant.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=jolabs40&repository=agenda-ha&category=integration)
[![Validate](https://github.com/jolabs40/agenda-ha/actions/workflows/validate.yml/badge.svg)](https://github.com/jolabs40/agenda-ha/actions/workflows/validate.yml)

[English version](README.md)

![Vue semaine](docs/week.png)

Un événement fixe ce que font les appareils liés (une température, un mode, marche ou arrêt, la
position d'un volet, une option, une valeur) et peut lancer des actions à son début et à sa fin.
Hors événement, l'agenda revient à son état par défaut.

Les captures sont en anglais ; l'interface s'affiche en français si Home Assistant l'est.

## Fonctions

- Un panneau dans la barre latérale, avec trois vues :
  - Semaine : un clic sur un créneau vide ajoute un événement, on déplace un bloc en le faisant
    glisser, on l'allonge en tirant son bord bas. Pour un événement répété, on choisit entre ce
    jour seulement et toute la série.
  - Maison : tous les agendas sur une journée, avec ce que fait chaque appareil en ce moment.
  - Liste : tous les événements et leur répétition.
- Répétition tous les N jours, semaines (jours au choix) ou mois, éventuellement jusqu'à une date.
  On peut retirer ou ajouter des jours à une série.
- Les jours fériés du pays peuvent être sautés, ou être les seuls jours retenus.
- N'importe quel calendrier peut servir de condition : sauter les jours où il a un événement
  (vacances scolaires, absences) ou ne garder que ceux-là.
- Des actions de début et de fin par événement, avec l'éditeur d'actions habituel de Home Assistant.
- Pour chaque agenda : une entité `calendar` (panneau Calendrier, déclencheurs de calendrier), un
  interrupteur Actif qui le suspend, les capteurs En ce moment et Prochain changement, et l'action
  `agenda.resync`.
- Après un redémarrage, les appareils liés sont remis dans l'état prévu (désactivable par agenda).
- Une carte de tableau de bord, `custom:agenda-card`.
- En français et en anglais.

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

Avec HACS, utiliser le bouton ci-dessus, ou ouvrir HACS, son menu, Dépôts personnalisés, et
ajouter `https://github.com/jolabs40/agenda-ha` avec le type Intégration. Télécharger Agenda,
puis redémarrer Home Assistant.

Sans HACS, copier `custom_components/agenda` dans le dossier `custom_components` de la
configuration, puis redémarrer Home Assistant.

Ajouter ensuite l'intégration Agenda depuis Paramètres > Appareils et services. Chaque entrée est
un agenda ; le bouton + du panneau en crée d'autres. Tout le reste se règle dans le panneau Agenda.

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

## Jours fériés

Ils suivent le pays réglé dans Paramètres > Système > Général. Un autre pays, ou une région
(Alsace-Moselle, outre-mer...), se choisit dans les réglages de n'importe quel agenda et vaut pour
tous.

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

## Licence

[MIT](LICENSE)
