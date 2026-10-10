# Лесной рубеж — браузерная игра

Откройте [game/index.html](game/index.html) в браузере. Установка зависимостей не нужна. Сервер разработки из `.claude/launch.json` («td») отдаёт папку `game/` на http://localhost:8123.

- Нажмите на одну из восьми круглых площадок на карте и выберите башню: **Лучники** (быстрые одиночные выстрелы) или **Маги** (медленные магические снаряды, взрыв задевает соседних врагов на половину урона).
- Повышайте уровень выбранной башни с 1-го до 5-го, получая золото за поверженных врагов.
- Нажмите **Начать волну**. Враги входят сверху и расходятся к левому и правому выходам.
- Отразите 10 волн, сохранив хотя бы одну жизнь.
- Клавиши 1–8 — выбрать площадку, Пробел — пауза, Enter — начать волну, Esc — снять выбор.

## Две папки: `game/` и `source/`

**`game/` — рабочие документы.** Здесь лежит всё, что игра использует прямо сейчас, и ничего больше: каждый файл в этой папке загружается игрой. Файлы в `game/` не правятся руками — их пересобирают скриптами из `source/`. Если что-то перестаёт использоваться, оно переезжает в `source/`.

**`source/` — исходники.** Всё остальное: исходные рисунки, модули, заготовки, прежние версии, неиспользуемые анимации, превью, скрипты сборки, отдельные инструменты.

```
game/
  index.html  style.css  game.js  jev.js
  maps/forest-pass.png                 карта
  towers/archers/level-1…5.png         башня лучников (без ткани и древка)
  towers/archers/pennant/level-N/      5 кадров флага с древком для каждого уровня
  towers/mage/level-N/                 слои мага: base, upper, roof, crystal-01…05, charge-01…05, tower.png
  enemies/warrior-level-1…4.png        враги, сетка 5 × 3 кадра
  effects/magic-orb/  magic-ground/    снаряд мага и удар по земле, по 10 кадров
  map-anim/                            анимации карты: waterfall-01, flags-left/right, birch-13, arch-23,
                                       pad-hover (5 кадров наведения на свободную площадку)
source/
  towers/archers/   исходные jpeg, flat/ (башни с нарисованной тканью), modular/, pennants/ (заготовки флагов)
  towers/mage/      centered-flag/, pixel-v3/ (рисунки 0,1,2,3,5), modular/, build_modular.py, build_crystal_charge.py
  effects/          build_magic_effects.py, листы v2, первые версии magic-orb-v1, magic-ground-v1
  map-anim-unused/  отключённые анимации: birch-14…17, arch-22, arch-24
  maps/             1-original.png (первая карта), 1-no-birches.png, style-concepts/, td_maps_v2.png
  previews/         превью и сравнения
  tools/            генераторы и balance-sim.js
  jev-maps/         отдельный инструмент карт JEV (сервер «jev-maps» на :8124)
  old/              старые башни и модульная башня v7 (modular-tower-v7.md)
```

## Как пересобрать файлы игры

Команды запускаются из корня проекта (нужны Python с Pillow, NumPy, SciPy).

| Что в `game/` | Команда |
| --- | --- |
| `towers/archers/level-N.png` | `python -I source/tools/strip_flag.py tower-01-thatched.png tower-02-wooden-roof.png …` |
| `towers/archers/pennant/level-N/` | `python -I source/tools/upgrade_pennant.py N <модуль 04-pennant.png> source/towers/archers/pennants/level-N/pennant.png`, затем `python -I source/tools/make_pennant.py source/towers/archers/pennants/level-N/pennant.png game/towers/archers/pennant/level-N` |
| `towers/mage/level-1/` соломенная башня со шпилем | `python -I source/towers/mage/build_intermediate_modular.py` |
| `towers/mage/level-2…5/` слои и кристалл | `python -I source/towers/mage/build_modular.py` (рисунки 1, 2, 3, 5 → уровни 2–5) |
| `towers/mage/level-2…5/charge-*` | `python -I source/towers/mage/build_crystal_charge.py` |
| `effects/magic-orb`, `effects/magic-ground` | `python -I source/effects/build_magic_effects.py` |
| `map-anim/*` | `source/tools/make_waterfall.py`, `make_flags.py`, `make_tree.py`, `make_arch.py` (пишут в `game/map-anim/`) |

Проверка баланса: `node source/tools/balance-sim.js` — гоняет `game/game.js` без браузера.

Кадры наведения на площадку (`map-anim/pad-hover`, 673 × 541 px): при наведении камни слегка шевелятся; после строительства башни анимация не показывается. При системной настройке уменьшения движения все анимации останавливаются на первом кадре.
