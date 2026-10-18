# Fugg City

A 3D open-world city game that runs in the browser. Steal cars, run jobs, shoot your way out of trouble, and outrun the cops across a procedurally generated city with a day/night cycle and weather.

Built with [Three.js](https://threejs.org) and plain ES modules. No build step.

## Play

- **Online:** the `main` branch deploys to GitHub Pages automatically (see `.github/workflows/pages.yml`). Enable Pages → "GitHub Actions" in the repo settings once, and the site goes live at `https://<user>.github.io/<repo>/`.
- **Locally:** serve the folder with any static server, then open `index.html`:
  ```sh
  python3 -m http.server 8080
  # → http://localhost:8080
  ```
  (ES modules need http, so double-clicking the file does not work.)
- **On a phone:** open the URL in Safari/Chrome and use *Add to Home Screen*. The game installs as a fullscreen landscape app and works offline.

## Controls

| Action | Keyboard / mouse | Controller | Touch |
| --- | --- | --- | --- |
| Move / steer | WASD or arrows | Left stick | Left-thumb virtual stick |
| Look | Mouse (click to capture) | Right stick | Drag on the right half |
| Sprint | Shift | A (hold) | RUN toggle |
| Jump | Space | X | JUMP |
| Enter / exit vehicle | E | Y | ENTER / EXIT |
| Gas / brake / reverse | W / S | RT / LT | GAS / BRAKE |
| Handbrake | Space | A or RB | E-BRK |
| Horn | H | B | HORN |
| Fire / punch | Left mouse or Ctrl | RT (on foot) | FIRE |
| Aim | Right mouse | LT (on foot) | AIM toggle |
| Switch weapon | Q, Tab or wheel | LB / RB | WPN |
| Camera distance | C | Back | ⟳ button |
| Pause | Esc | Start | ❚❚ button |

Controller and touch aiming use a soft lock-on: the nearest enemy in front of you is targeted automatically.

## What's in the city

- **Districts:** downtown towers with neon, a commercial belt, an industrial yard with warehouses and container stacks, residential streets, and a beach with a pier.
- **Traffic:** AI cars follow lanes, obey traffic lights, avoid each other, and honk when you block them. Carjack any of them.
- **Pedestrians:** people walk the sidewalks, flee from gunfire and speeding cars, and can be run over or shot.
- **Police:** wanted stars rise when you hurt people, shoot, or carjack in view of a cop. Cruisers path-find to you and ram you; cops get out and shoot when you're on foot. Get caught and you're **Busted**; die and you're **Wasted**.
- **Weapons:** fists, pistol, SMG, shotgun. Find pickups around the map or buy ammo at the **Ammu-Mart** marker (A).
- **Jobs (markers on the minimap):** Courier (C), Taxi (T), Street race (R), Contract hit (X). The Hospital (H) heals, Pay n Spray (S) clears your wanted level when you drive in.
- **Collectibles:** 20 hidden packages worth $100 each, plus a $5,000 bonus for the set. Cash and health pickups are scattered around.
- **World:** a full day/night cycle (10 real minutes per day), rain that rolls in and out, headlights, street lamps, and lit windows at night.

Progress (money, weapons, packages) is saved in the browser.

## Vehicles

Sedan, sports car, muscle car, van, box truck, bus, taxi, police cruiser and motorcycle. Damage them enough and they catch fire, then explode. Get out first.

## Project layout

```
index.html            page shell, HUD, touch buttons, menus
style.css             UI styling (responsive, safe-area aware)
src/main.js           game loop and glue
src/city.js           procedural city, districts, roads, road & sidewalk graphs
src/vehicle.js        vehicle models and arcade physics
src/driver.js         lane-following / pursuit AI driver
src/traffic.js        traffic population, carjacking
src/pedestrians.js    civilians and cops on foot
src/police.js         wanted level and pursuit
src/weapons.js        hitscan weapons, auto-aim
src/missions.js       markers, jobs, shops, pickups
src/player.js         on-foot character, enter/exit vehicles
src/camera.js         third-person camera with building collision
src/input.js          keyboard, mouse, gamepad and touch merged into one action state
src/touch.js          virtual joystick and buttons
src/effects.js        particles, tracers, decals, rain, fires
src/daynight.js       sun, sky, fog, weather
src/hud.js            HUD, minimap
src/audio.js          procedural WebAudio sound
vendor/three.module.js  Three.js (vendored, MIT)
sw.js, manifest.webmanifest   PWA install + offline cache
```

## Settings

Pause menu: toggle touch controls, shadows (off by default on phones), inverted look, sound, and look sensitivity.
