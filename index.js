class Color {
    constructor(r, g, b, a) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
    }

    toRgba() {
        return `rgba(${this.r * 255}, ${this.g * 255}, ${this.b * 255}, ${this.a})`;
    }

    withAlpha(a) {
        return new Color(this.r, this.g, this.b, a);
    }

    grayScale() {
        let x = (this.r + this.g + this.b) / 3;
        return new Color(x, x, x, this.a);
    }

    static hex(hexcolor) {
        let matches =
            hexcolor.match(/#([0-9a-z]{2})([0-9a-z]{2})([0-9a-z]{2})/i);
        if (matches) {
            let [, r, g, b] = matches;
            return new Color(parseInt(r, 16) / 255.0,
                             parseInt(g, 16) / 255.0,
                             parseInt(b, 16) / 255.0,
                             1.0);
        } else {
            throw `Could not parse ${hexcolor} as color`;
        }
    }
}

class V2 {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    add(that) {
        return new V2(this.x + that.x, this.y + that.y);
    }

    sub(that) {
        return new V2(this.x - that.x, this.y - that.y);
    }

    scale(s) {
        return new V2(this.x * s, this.y * s);
    }

    len() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    normalize() {
        const n = this.len();
        return new V2(this.x / n, this.y / n);
    }

    dist(that) {
        return this.sub(that).len();
    }

    static polar(mag, dir) {
        return new V2(Math.cos(dir) * mag, Math.sin(dir) * mag);
    }
}

const PLAYER_COLOR = Color.hex("#f43841");
const PLAYER_SPEED = 1000;
const PLAYER_RADIUS = 69;
const TUTORIAL_POPUP_SPEED = 1.7;
const BULLET_RADIUS = 42;
const BULLET_SPEED = 2000;
const BULLET_LIFETIME = 5.0;
const ENEMY_SPEED = PLAYER_SPEED / 3;
const ENEMY_RADIUS = PLAYER_RADIUS;
const ENEMY_COLOR = Color.hex("#9e95c7");
const ENEMY_SPAWN_COOLDOWN = 1.0;
const ENEMY_SPAWN_DISTANCE = 1500.0;
const PARTICLES_COUNT = 50;
const PARTICLE_RADIUS = 10.0;
const PARTICLE_COLOR = ENEMY_COLOR;
const PARTICLE_MAG = BULLET_SPEED;
const PARTICLE_LIFETIME = 1.0;
const MESSAGE_COLOR = Color.hex("#ffffff");

const directionMap = {
    'KeyS': new V2(0, 1.0),
    'KeyW': new V2(0, -1.0),
    'KeyA': new V2(-1.0, 0),
    'KeyD': new V2(1.0, 0)
};

class Particle {
    constructor(pos, vel, lifetime, radius) {
        this.pos = pos;
        this.vel = vel;
        this.lifetime = lifetime;
        this.radius = radius;
    }

    render(context) {
        const a = this.lifetime / PARTICLE_LIFETIME;
        fillCircle(context, this.pos, this.radius,
                   PARTICLE_COLOR.withAlpha(a));
    }

    update(dt) {
        this.pos = this.pos.add(this.vel.scale(dt));
        this.lifetime -= dt;
    }
}

// TODO(#2): burst particle in a particular direction;
function particleBurst(particles, center) {
    const N = Math.random() * PARTICLES_COUNT;
    for (let i = 0; i < N; ++i) {
        // TODO(#3): proper random floating point ranges
        particles.push(new Particle(
            center,
            V2.polar(Math.random() * PARTICLE_MAG, Math.random() * 2 * Math.PI),
            Math.random() * PARTICLE_LIFETIME,
            Math.random() * PARTICLE_RADIUS + 10.0));
    }
}

class Enemy {
    constructor(pos) {
        this.pos = pos;
        this.ded = false;
    }

    update(dt, followPos) {
        let vel = followPos
            .sub(this.pos)
            .normalize()
            .scale(ENEMY_SPEED * dt);
        this.pos = this.pos.add(vel);
    }

    render(context) {
        fillCircle(context, this.pos, ENEMY_RADIUS, ENEMY_COLOR);
    }
}

class Bullet {
    constructor(pos, vel) {
        this.pos = pos;
        this.vel = vel;
        this.lifetime = BULLET_LIFETIME;
    }

    update(dt) {
        this.pos = this.pos.add(this.vel.scale(dt));
        this.lifetime -= dt;
    }

    render(context) {
        fillCircle(context, this.pos, BULLET_RADIUS, PLAYER_COLOR);
    }
}

function fillMessage(context, text, color) {
    const width = context.canvas.width;
    const height = context.canvas.height;

    context.fillStyle = color.toRgba();
    context.font = "30px LexendMega";
    context.textAlign = "center";
    context.fillText(text, width / 2, height / 2);
}

class TutorialPopup {
    constructor(text) {
        this.alpha = 0.0;
        this.dalpha = 0.0;
        this.text = text;
        this.onFadedOut = undefined;
        this.onFadedIn = undefined;
    }

    update(dt) {
        this.alpha += this.dalpha * dt;

        if (this.dalpha < 0.0 && this.alpha <= 0.0) {
            this.dalpha = 0.0;
            this.alpha = 0.0;

            this.onFadedOut?.();
        } else if (this.dalpha > 0.0 && this.alpha >= 1.0) {
            this.dalpha = 0.0;
            this.alpha = 1.0;

            this.onFadedIn?.();
        }
    }

    render(context) {
        fillMessage(context, this.text, MESSAGE_COLOR.withAlpha(this.alpha));
    }

    fadeIn() {
        this.dalpha = TUTORIAL_POPUP_SPEED;
    }

    fadeOut() {
        this.dalpha = -TUTORIAL_POPUP_SPEED;
    }
}

const TutorialState = Object.freeze({
    "LearningMovement": 0,
    "LearningShooting": 1,
    "Finished": 2,
});

const TutorialMessages = Object.freeze([
    "WASD to move",
    "Left Mouse Click to shoot",
    ""
]);

class Tutorial {
    constructor() {
        this.state = 0;
        this.popup = new TutorialPopup(TutorialMessages[this.state]);
        this.popup.fadeIn();
        this.popup.onFadedOut = () => {
            this.popup.text = TutorialMessages[this.state];
            this.popup.fadeIn();
        };
    }

    update(dt) {
        this.popup.update(dt);
    }

    render(context) {
        this.popup.render(context);
    }

    playerMoved() {
        if (this.state == TutorialState.LearningMovement) {
            this.popup.fadeOut();
            this.state += 1;
        }
    }

    playerShot() {
        if (this.state == TutorialState.LearningShooting) {
            this.popup.fadeOut();
            this.state += 1;
        }
    }
}

function renderEntities(context, entities) {
    for (let entity of entities) {
        entity.render(context);
    }
}

// TODO(#5): no way for the player to die
// TODO(#6): killing enemies does not give any points
// TODO(#7): the field of view depends on the resolution
// TODO(#8): the game stops when you unfocus the browser
// TODO(#9): some sort of inertia during player movement
// TODO(#13): player can easily get lost outside of the screen
class Game {
    // TODO(#10): the player should be initially positioned at the center of the screen
    playerPos = new V2(PLAYER_RADIUS + 10, PLAYER_RADIUS + 10);
    mousePos = new V2(0, 0);
    pressedKeys = new Set();
    tutorial = new Tutorial();
    playerLearntHowToMove = false;
    bullets = [];
    enemies = [];
    particles = [];
    enemySpawnRate = ENEMY_SPAWN_COOLDOWN;
    enemySpawnCooldown = this.enemySpawnRate;
    paused = false;

    update(dt) {
        if (this.paused) {
            return;
        }

        let vel = new V2(0, 0);
        let moved = false;
        for (let key of this.pressedKeys) {
            if (key in directionMap) {
                vel = vel.add(directionMap[key].scale(PLAYER_SPEED));
                moved = true;
            }
        }
        if (moved) {
            this.tutorial.playerMoved();
        }

        this.playerPos = this.playerPos.add(vel.scale(dt));

        this.tutorial.update(dt);

        for (let enemy of this.enemies) {
            for (let bullet of this.bullets) {
                if (!enemy.ded &&
                    enemy.pos.dist(bullet.pos) <= BULLET_RADIUS + ENEMY_RADIUS)
                {
                    enemy.ded = true;
                    bullet.lifetime = 0.0;
                    particleBurst(this.particles, enemy.pos);
                }
            }
        }

        for (let bullet of this.bullets) {
            bullet.update(dt);
        }
        this.bullets = this.bullets.filter(bullet => bullet.lifetime > 0.0);

        for (let particle of this.particles) {
            particle.update(dt);
        }
        this.particles = this.particles.filter(particle => particle.lifetime > 0.0);

        for (let enemy of this.enemies) {
            enemy.update(dt, this.playerPos);
        }
        this.enemies = this.enemies.filter(enemy => !enemy.ded);

        if (this.tutorial.state == TutorialState.Finished) {
            this.enemySpawnCooldown -= dt;
            if (this.enemySpawnCooldown <= 0.0) {
                this.spawnEnemy();
                this.enemySpawnCooldown = this.enemySpawnRate;
                // TODO(#11): spawning rate ramps up too quickly
                this.enemySpawnRate = Math.max(0.01, this.enemySpawnRate - 0.01);
            }
        }
    }

    render(context) {
        const width = context.canvas.width;
        const height = context.canvas.height;

        context.clearRect(0, 0, width, height);
        fillCircle(context, this.playerPos, PLAYER_RADIUS, PLAYER_COLOR);

        renderEntities(context, this.bullets);
        renderEntities(context, this.particles);
        renderEntities(context, this.enemies);

        if (!this.paused) {
            this.tutorial.render(context);
        } else {
            fillMessage(context, "PAUSED (press SPACE to resume)", MESSAGE_COLOR);
        }
    }

    spawnEnemy() {
        // TODO(#12): sometimes enemies are spawned on the screen
        let dir = Math.random() * 2 * Math.PI;
        this.enemies.push(new Enemy(this.playerPos.add(V2.polar(ENEMY_SPAWN_DISTANCE, dir))));
    }

    togglePause() {
        this.paused = !this.paused;
        if (this.paused) {
            globalFillCircleFilter = grayScaleFilter;
        } else {
            globalFillCircleFilter = idFilter;
        }
    }

    keyDown(event) {
        if (event.code == 'Space') {
            this.togglePause();
        }

        this.pressedKeys.add(event.code);
    }

    keyUp(event) {
        this.pressedKeys.delete(event.code);
    }

    mouseMove(event) {
    }

    mouseDown(event) {
        if (this.paused) {
            return;
        }

        this.tutorial.playerShot();
        const mousePos = new V2(event.offsetX, event.offsetY);
        const bulletDir = mousePos
              .sub(this.playerPos)
              .normalize();
        const bulletVel = bulletDir.scale(BULLET_SPEED);
        const bulletPos = this
              .playerPos
              .add(bulletDir.scale(PLAYER_RADIUS + BULLET_RADIUS));

        this.bullets.push(new Bullet(bulletPos, bulletVel));
    }
}

function grayScaleFilter(color) {
    return color.grayScale();
}

function idFilter(color) {
    return color;
}

let globalFillCircleFilter = idFilter;

function fillCircle(context, center, radius, color) {
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, 2 * Math.PI, false);
    context.fillStyle = globalFillCircleFilter(color).toRgba();
    context.fill();
}

const game = new Game();

(() => {
    const canvas = document.getElementById("game");
    const context = canvas.getContext("2d");
    let windowWasResized = true;

    let start;
    function step(timestamp) {
        if (start === undefined) {
            start = timestamp;
        }
        const dt = (timestamp - start) * 0.001;
        start = timestamp;

        if (windowWasResized) {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            windowWasResized = false;
        }

        game.update(dt);
        game.render(context);

        window.requestAnimationFrame(step);
    }

    window.requestAnimationFrame(step);

    document.addEventListener('keydown', event => {
        game.keyDown(event);
    });

    document.addEventListener('keyup', event => {
        game.keyUp(event);
    });

    document.addEventListener('mousemove', event => {
        game.mouseMove(event);
    });

    document.addEventListener('mousedown', event => {
        game.mouseDown(event);
    });

    window.addEventListener('resize', event => {
        windowWasResized = true;
    });
})();
