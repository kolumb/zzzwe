function lerp(a, b, t) {
    return a + (b - a) * t;
}

function randomBetween(min = 0, max = 1) {
    return Math.random() * (max - min) + min;
}

const randomAngle = () => randomBetween(0, 2 * Math.PI);

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

    grayScale(t = 1.0) {
        let x = (this.r + this.g + this.b) / 3;
        return new Color(
            lerp(this.r, x, t),
            lerp(this.g, x, t),
            lerp(this.b, x, t),
            this.a);
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
            throw new Error(`Could not parse ${hexcolor} as color`);
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
        return n === 0 ? new V2(0, 0) : new V2(this.x / n, this.y / n);
    }

    dist(that) {
        return this.sub(that).len();
    }

    static polar(mag, dir) {
        return new V2(Math.cos(dir) * mag, Math.sin(dir) * mag);
    }
}

class RendererWebGL {
    cameraPos = new V2(0, 0);
    cameraVel = new V2(0, 0);

    vertexShaderSource = `#version 100
precision mediump float;

uniform vec2 resolution;

attribute vec2 meshPosition;

attribute vec2 circleCenter;
attribute float circleRadius;
attribute vec4 circleColor;

varying vec4 vertexColor;
varying vec2 vertexUV;

vec2 camera_projection(vec2 position) {
    return vec2(2.0 * position.x / resolution.x, 2.0 * position.y / resolution.y);
}

void main() {
    float radius = circleRadius;
    gl_Position = vec4(camera_projection(meshPosition * radius + circleCenter), 0.0, 1.0);
    vertexColor = circleColor;
    vertexUV = meshPosition;
}
`;

    fragmentShaderSource =`#version 100
precision mediump float;

varying vec4 vertexColor;
varying vec2 vertexUV;

void main() {
    vec4 color = vertexColor;
    gl_FragColor = length(vertexUV) < 1.0 ? color : vec4(0.0);
}
`;

    constructor(gl, ext) {
        this.gl = gl;
        this.ext = ext;
        this.circlesCount = 0;

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        let vertexShader = this.compileShaderSource(this.vertexShaderSource, gl.VERTEX_SHADER);
        let fragmentShader = this.compileShaderSource(this.fragmentShaderSource, gl.FRAGMENT_SHADER);
        this.program = this.linkShaderProgram([vertexShader, fragmentShader]);
        gl.useProgram(this.program);

        this.resolutionUniform = gl.getUniformLocation(this.program, 'resolution');

        // Mesh Position
        {
            this.meshPositionBufferData = new Float32Array(TRIANGLE_PAIR * TRIANGLE_VERTICIES * VEC2_COUNT);
            for (let triangle = 0; triangle < TRIANGLE_PAIR; ++triangle) {
                for (let vertex = 0; vertex < TRIANGLE_VERTICIES; ++vertex) {
                    const quad = triangle + vertex;
                    const index =
                          triangle * TRIANGLE_VERTICIES * VEC2_COUNT +
                          vertex * VEC2_COUNT;
                    this.meshPositionBufferData[index + VEC2_X] = (2 * (quad & 1) - 1);
                    this.meshPositionBufferData[index + VEC2_Y] = (2 * ((quad >> 1) & 1) - 1);
                }
            }

            this.meshPositionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.meshPositionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.meshPositionBufferData, gl.STATIC_DRAW);

            const meshPositionAttrib = gl.getAttribLocation(this.program, 'meshPosition');
            gl.vertexAttribPointer(
                meshPositionAttrib,
                VEC2_COUNT,
                gl.FLOAT,
                false,
                0,
                0);
            gl.enableVertexAttribArray(meshPositionAttrib);
        }

        // Circle Center
        {
            this.circleCenterBufferData = new Float32Array(VEC2_COUNT * CIRCLE_BATCH_CAPACITY);
            this.circleCenterBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.circleCenterBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.circleCenterBufferData, gl.DYNAMIC_DRAW);

            const circleCenterAttrib = gl.getAttribLocation(this.program, 'circleCenter');
            gl.vertexAttribPointer(
                circleCenterAttrib,
                VEC2_COUNT,
                gl.FLOAT,
                false,
                0,
                0);
            gl.enableVertexAttribArray(circleCenterAttrib);
            ext.vertexAttribDivisorANGLE(circleCenterAttrib, 1);
        }

        // Circle Radius
        {
            this.circleRadiusBufferData = new Float32Array(CIRCLE_BATCH_CAPACITY);
            this.circleRadiusBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.circleRadiusBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.circleRadiusBufferData, gl.DYNAMIC_DRAW);

            const circleRadiusAttrib = gl.getAttribLocation(this.program, 'circleRadius');
            gl.vertexAttribPointer(
                circleRadiusAttrib,
                1,
                gl.FLOAT,
                false,
                0,
                0);
            gl.enableVertexAttribArray(circleRadiusAttrib);
            ext.vertexAttribDivisorANGLE(circleRadiusAttrib, 1);
        }

        // Circle Color
        {
            this.circleColorBufferData = new Float32Array(RGBA_COUNT * CIRCLE_BATCH_CAPACITY);
            this.circleColorBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.circleColorBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.circleColorBufferData, gl.DYNAMIC_DRAW);

            const circleColorAttrib = gl.getAttribLocation(this.program, 'circleColor');
            gl.vertexAttribPointer(
                circleColorAttrib,
                RGBA_COUNT,
                gl.FLOAT,
                false,
                0,
                0);
            gl.enableVertexAttribArray(circleColorAttrib);
            ext.vertexAttribDivisorANGLE(circleColorAttrib, 1);
        }
    }

    // RENDERER INTERFACE //////////////////////////////
    setViewport(width, height) {
        this.gl.viewport(0, 0, width, height);
        this.gl.uniform2f(this.resolutionUniform, width, height);
    }

    setTarget(target) {
        this.cameraVel = target.sub(this.cameraPos);
    }

    update(dt) {
        this.cameraPos = this.cameraPos.add(this.cameraVel.scale(dt));
    }

    present() {
        // TODO: bufferSubData should probably use subview of this Float32Array if that's even possible
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.circleCenterBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.circleCenterBufferData);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.circleRadiusBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.circleRadiusBufferData);
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.circleColorBuffer);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.circleColorBufferData);
        this.ext.drawArraysInstancedANGLE(this.gl.TRIANGLES, 0, TRIANGLE_PAIR * TRIANGLE_VERTICIES, this.circlesCount);
    }

    clear() {
        this.circlesCount = 0;
        this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }

    background() {
        // TODO: RendererWebGL.background() is not implemented
    }

    fillCircle(center, radius, color) {
        if (this.circlesCount < CIRCLE_BATCH_CAPACITY) {
            this.circleCenterBufferData[this.circlesCount * VEC2_COUNT + VEC2_X] = center.x;
            this.circleCenterBufferData[this.circlesCount * VEC2_COUNT + VEC2_Y] = center.y;

            this.circleRadiusBufferData[this.circlesCount] = radius;

            this.circleColorBufferData[this.circlesCount * RGBA_COUNT + RGBA_R] = color.r;
            this.circleColorBufferData[this.circlesCount * RGBA_COUNT + RGBA_G] = color.g;
            this.circleColorBufferData[this.circlesCount * RGBA_COUNT + RGBA_B] = color.b;
            this.circleColorBufferData[this.circlesCount * RGBA_COUNT + RGBA_A] = color.a;

            this.circlesCount += 1;
        }
    }

    fillMessage(text, color) {
        // TODO: RendererWebGL.fillMessage() is not implemented
    }
    ////////////////////////////////////////////////////////////

    shaderTypeToString(shaderType) {
        switch (shaderType) {
        case this.gl.VERTEX_SHADER: return 'Vertex';
        case this.gl.FRAGMENT_SHADER: return 'Fragment';
        default: return shaderType;
        }
    }

    compileShaderSource(source, shaderType) {
        const shader = this.gl.createShader(shaderType);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            throw new Error(`Could not compile ${this.shaderTypeToString(shaderType)} shader: ${this.gl.getShaderInfoLog(shader)}`);
        }
        return shader;
    }

    linkShaderProgram(shaders) {
        const program = this.gl.createProgram();
        for (let shader of shaders) {
            this.gl.attachShader(program, shader);
        }
        this.gl.linkProgram(program);
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            throw new Error(`Could not link shader program: ${this.gl.getProgramInfoLog(program)}`);
        }
        return program;
    }
}

class Renderer2D {
    cameraPos = new V2(0, 0);
    cameraVel = new V2(0, 0);
    grayness = 0.0;
    unitsPerPixel = 1.0;

    constructor(context2d) {
        this.context2d = context2d;
    }

    update(dt) {
        this.cameraPos = this.cameraPos.add(this.cameraVel.scale(dt));
    }

    width() {
        return this.context2d.canvas.width * this.unitsPerPixel;
    }

    height() {
        return this.context2d.canvas.height * this.unitsPerPixel;
    }

    getScreenWorldBounds() {
        let topLeft = this.screenToWorld(new V2(0, 0));
        let bottomRight = this.screenToWorld(new V2(this.context2d.canvas.width, this.context2d.canvas.height));
        return [topLeft, bottomRight];
    }

    screenToWorld(point) {
        const width = this.context2d.canvas.width;
        const height = this.context2d.canvas.height;
        return point
            .sub(new V2(width / 2, height / 2))
            .scale(this.unitsPerPixel)
            .add(this.cameraPos);
    }

    worldToCamera(point) {
        const width = this.width();
        const height = this.height();
        return point.sub(this.cameraPos).add(new V2(width / 2, height / 2));
    }

    clear() {
        const width = this.width();
        const height = this.height();
        this.context2d.clearRect(0, 0, width, height);
    }

    setTarget(target) {
        this.cameraVel = target.sub(this.cameraPos);
    }

    fillCircle(center, radius, color) {
        const screenCenter = this.worldToCamera(center);
        this.context2d.fillStyle = color.grayScale(this.grayness).toRgba();
        this.context2d.beginPath();
        this.context2d.arc(screenCenter.x, screenCenter.y, radius, 0, 2 * Math.PI, false);
        this.context2d.fill();
    }

    fillRect(x, y, w, h, color) {
        const screenPos = this.worldToCamera(new V2(x, y));
        this.context2d.fillStyle = color.grayScale(this.grayness).toRgba();
        this.context2d.fillRect(screenPos.x, screenPos.y, w, h);
    }

    fillMessage(text, color) {
        const width = this.width();
        const height = this.height();

        const FONT_SIZE = 69;
        const LINE_PADDING = 69;
        this.context2d.fillStyle = color.toRgba();
        this.context2d.font = `${FONT_SIZE}px LexendMega`;
        this.context2d.textAlign = "center";
        this.context2d.textBaseline = "middle";
        const lines = text.split("\n");
        const MESSAGE_HEIGTH = (FONT_SIZE + LINE_PADDING) * (lines.length - 1);
        for (let i = 0; i < lines.length; ++i) {
            this.context2d.fillText(lines[i], width / 2, (height - MESSAGE_HEIGTH) / 2 + (FONT_SIZE + LINE_PADDING) * i);
        }
    }

    drawLine(points, color) {
        this.context2d.beginPath();
        for (let i = 0; i < points.length; ++i) {
            let screenPoint = this.worldToCamera(points[i]);
            if (i == 0) this.context2d.moveTo(screenPoint.x, screenPoint.y);
            else this.context2d.lineTo(screenPoint.x, screenPoint.y);
        }
        this.context2d.strokeStyle = color.toRgba();
        this.context2d.stroke();
    }

    setViewport(width, height) {
        const IDENTITY = new DOMMatrix();

        const scale = Math.min(
            width / DEFAULT_RESOLUTION.w,
            height / DEFAULT_RESOLUTION.h,
        );

        this.unitsPerPixel = 1 / scale;

        this.context2d.setTransform(IDENTITY);
        this.context2d.scale(scale, scale);
    }

    present() {
        // Nothing to do. Everything is already presented by the 2D HTML canvas
    }

    background() {
        let bounds = this.getScreenWorldBounds();
        let gridBoundsXMin = Math.floor(bounds[0].x / BACKGROUND_CELL_WIDTH);
        let gridBoundsXMax = Math.floor(bounds[1].x / BACKGROUND_CELL_WIDTH);
        let gridBoundsYMin = Math.floor(bounds[0].y / BACKGROUND_CELL_HEIGHT);
        let gridBoundsYMax = Math.floor(bounds[1].y / BACKGROUND_CELL_HEIGHT);

        for (let cellX = gridBoundsXMin; cellX <= gridBoundsXMax + 1; ++cellX) {
            for (let cellY = gridBoundsYMin; cellY <= gridBoundsYMax; ++cellY) {
                let offset = new V2(
                    cellX * BACKGROUND_CELL_WIDTH,
                    (cellY + (cellX % 2 == 0 ? 0.5 : 0)) * BACKGROUND_CELL_HEIGHT,
                );
                let points = BACKGROUND_CELL_POINTS.map(p => p.add(offset));
                this.drawLine(points, BACKGROUND_LINE_COLOR);
            }
        }
    }
}

const TRIANGLE_PAIR = 2;
const TRIANGLE_VERTICIES = 3;
const VEC2_COUNT = 2;
const VEC2_X = 0;
const VEC2_Y = 1;
const RGBA_COUNT = 4;
const RGBA_R = 0;
const RGBA_G = 1;
const RGBA_B = 2;
const RGBA_A = 3;
const DEFAULT_RESOLUTION = {w: 3840, h: 2160};
const PLAYER_COLOR = Color.hex("#f43841");
const PLAYER_SPEED = 1000;
const PLAYER_RADIUS = 69;
const PLAYER_MAX_HEALTH = 100;
const PLAYER_SHOOT_COOLDOWN = 0.25;
const PLAYER_TRAIL_RATE = 3.0;
const TUTORIAL_POPUP_SPEED = 1.7;
const BULLET_RADIUS = 42;
const BULLET_SPEED = 2000;
const BULLET_LIFETIME = 5.0;
const ENEMY_SPEED = PLAYER_SPEED / 3;
const ENEMY_RADIUS = PLAYER_RADIUS;
const ENEMY_SPAWN_ANIMATION_SPEED = ENEMY_RADIUS * 8;
const ENEMY_COLOR = Color.hex("#9e95c7");
const ENEMY_SPAWN_COOLDOWN = 1.0;
const ENEMY_SPAWN_GROWTH = 1.01;
const ENEMY_SPAWN_DISTANCE = 1500.0;
const ENEMY_DESPAWN_DISTANCE = ENEMY_SPAWN_DISTANCE * 2;
const ENEMY_DAMAGE = PLAYER_MAX_HEALTH / 5;
const ENEMY_KILL_HEAL = PLAYER_MAX_HEALTH / 10;
const ENEMY_KILL_SCORE = 100;
const ENEMY_TRAIL_RATE = 2.0;
const PARTICLES_COUNT_RANGE = [0, 50];
const PARTICLE_RADIUS_RANGE = [10.0, 20.0];
const PARTICLE_MAG_RANGE = [0, BULLET_SPEED];
const PARTICLE_MAX_LIFETIME = 1.0;
const PARTICLE_LIFETIME_RANGE = [0, PARTICLE_MAX_LIFETIME];
const MESSAGE_COLOR = Color.hex("#ffffff");
const TRAIL_COOLDOWN = 1 / 60;
const BACKGROUND_CELL_RADIUS = 120;
const BACKGROUND_LINE_COLOR = Color.hex("#ffffff").withAlpha(0.5);
const BACKGROUND_CELL_WIDTH = 1.5 * BACKGROUND_CELL_RADIUS;
const BACKGROUND_CELL_HEIGHT = Math.sqrt(3) * BACKGROUND_CELL_RADIUS;
const BACKGROUND_CELL_POINTS = (() => {
    let points = [];
    for (let i = 0; i < 4; ++i) {
        let angle = 2 * Math.PI * i / 6;
        points.push(new V2(Math.cos(angle), Math.sin(angle)).scale(BACKGROUND_CELL_RADIUS));
    }
    return points;
})();
const CIRCLE_BATCH_CAPACITY = 1024;

const directionMap = {
    'KeyS': new V2(0, 1.0),
    'KeyW': new V2(0, -1.0),
    'KeyA': new V2(-1.0, 0),
    'KeyD': new V2(1.0, 0)
};

class Particle {
    constructor(pos, vel, lifetime, radius, color) {
        this.pos = pos;
        this.vel = vel;
        this.lifetime = lifetime;
        this.radius = radius;
        this.color = color;
    }

    render(renderer) {
        const a = this.lifetime / PARTICLE_MAX_LIFETIME;
        renderer.fillCircle(this.pos, this.radius,
                            this.color.withAlpha(a));
    }

    update(dt) {
        this.pos = this.pos.add(this.vel.scale(dt));
        this.lifetime -= dt;
    }
}

// TODO(#2): burst particle in a particular direction;
function particleBurst(particles, center, color) {
    const N = randomBetween(...PARTICLES_COUNT_RANGE);
    for (let i = 0; i < N; ++i) {
        particles.push(new Particle(
            center,
            V2.polar(randomBetween(...PARTICLE_MAG_RANGE), randomAngle()),
            randomBetween(...PARTICLE_LIFETIME_RANGE),
            randomBetween(...PARTICLE_RADIUS_RANGE),
            color));
    }
}

class Enemy {
    trail = new Trail(ENEMY_RADIUS, ENEMY_COLOR, ENEMY_TRAIL_RATE);

    constructor(pos) {
        this.pos = pos;
        this.ded = false;
        this.radius = 0.0;
    }

    update(dt, followPos) {
        let vel = followPos
            .sub(this.pos)
            .normalize()
            .scale(ENEMY_SPEED * dt);
        this.trail.push(this.pos);
        this.pos = this.pos.add(vel);
        this.trail.update(dt);

        if (this.radius < ENEMY_RADIUS) {
            this.radius += ENEMY_SPAWN_ANIMATION_SPEED * dt;
        } else {
            this.radius = ENEMY_RADIUS;
        }
    }

    render(renderer) {
        this.trail.render(renderer);
        renderer.fillCircle(this.pos, this.radius, ENEMY_COLOR);
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

    render(renderer) {
        renderer.fillCircle(this.pos, BULLET_RADIUS, PLAYER_COLOR);
    }
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

    render(renderer) {
        renderer.fillMessage(this.text, MESSAGE_COLOR.withAlpha(this.alpha));
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

const TutorialMessages = window.matchMedia("(pointer: coarse)").matches ? Object.freeze([
    "Drag left side of screen to move",
    "Drag or tap right side of screen to shoot",
    ""
]) : Object.freeze([
    "WASD to move",
    "Left Mouse Click to shoot",
    ""
]);

const LOCAL_STORAGE_TUTORIAL = "tutorial";

class Tutorial {
    constructor() {
        this.state = window.localStorage.getItem(LOCAL_STORAGE_TUTORIAL) ?? 0;
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

    render(renderer) {
        this.popup.render(renderer);
    }

    playerMoved() {
        if (this.state == TutorialState.LearningMovement) {
            this.popup.fadeOut();
            this.state += 1;
            window.localStorage.setItem(LOCAL_STORAGE_TUTORIAL, this.state);
        }
    }

    playerShot() {
        if (this.state == TutorialState.LearningShooting) {
            this.popup.fadeOut();
            this.state += 1;
            window.localStorage.setItem(LOCAL_STORAGE_TUTORIAL, this.state);
        }
    }
}

class Trail {
    trail = [];
    cooldown = 0;
    disabled = false;

    constructor(radius, color, rate) {
        this.radius = radius;
        this.color = color;
        this.rate = rate;
    }

    render(renderer) {
        const n = this.trail.length;
        for (let i = 0; i < n; ++i) {
            renderer.fillCircle(
                this.trail[i].pos,
                this.radius * this.trail[i].a,
                this.color.withAlpha(0.2 * this.trail[i].a));
        }
    }

    update(dt) {
        for (let dot of this.trail) {
            dot.a -= this.rate * dt;
        }

        while (this.trail.length > 0 && this.trail[0].a <= 0.0) {
            this.trail.shift();
        }

        this.cooldown -= dt;
    }

    push(pos) {
        if (!this.disabled && this.cooldown <= 0)  {
            this.trail.push({
                pos: pos,
                a: 1.0
            });
            this.cooldown = TRAIL_COOLDOWN;
        }
    }
}

class Player {
    health = PLAYER_MAX_HEALTH;
    target = new V2(0.0, 0.0);
    shootCooldown = PLAYER_SHOOT_COOLDOWN;
    lastShoot = 0.0;
    trail = new Trail(PLAYER_RADIUS, PLAYER_COLOR, PLAYER_TRAIL_RATE);

    constructor(pos) {
        this.pos = pos;
        this.accuracy = 0;
        this.shootCount = window.localStorage.getItem(LOCAL_STORAGE_TUTORIAL) == TutorialState.Finished ? 0 : -1;
    }

    render(renderer) {
        this.trail.render(renderer);

        if (this.health > 0.0) {
            renderer.fillCircle(this.pos, PLAYER_RADIUS, PLAYER_COLOR);
        }
    }

    update(dt, vel) {
        this.trail.push(this.pos);
        this.pos = this.pos.add(vel.scale(dt));
        this.trail.update(dt);
    }

    shoot() {
        this.shootCount += 1;
        const bulletDir = this.target
              .sub(this.pos)
              .normalize();
        const bulletVel = bulletDir.scale(BULLET_SPEED);
        const bulletPos = this
              .pos
              .add(bulletDir.scale(PLAYER_RADIUS + BULLET_RADIUS));

        return new Bullet(bulletPos, bulletVel);
    }

    damage(value) {
        this.health = Math.max(this.health - value, 0.0);
    }

    heal(value) {
        if (this.health > 0.0) {
            this.health = Math.min(this.health + value, PLAYER_MAX_HEALTH);
        }
    }
}

// TODO(#8): the game stops when you unfocus the browser
// TODO(#9): some sort of inertia during player movement
class Game {
    restart() {
        // TODO(#37): a player respawn animation similar to the enemy's one
        this.player = new Player(new V2(0, 0));
        this.score = 0;
        this.mousePos = new V2(0, 0);
        this.movingTouchId = undefined;
        this.movingTouchStart = new V2(0.0, 0.0);
        this.movingTouchDirection = new V2(0.0, 0.0);
        this.shootingTouchId = undefined;
        this.shootingTouchStart = new V2(0.0, 0.0);
        this.shootingTouchDirection = new V2(0.0, 0.0);
        this.pressedKeys = new Set();
        this.tutorial = new Tutorial();
        this.bullets = [];
        this.enemies = [];
        this.particles = [];
        this.enemySpawnRate = ENEMY_SPAWN_COOLDOWN;
        this.enemySpawnCooldown = ENEMY_SPAWN_COOLDOWN;
        this.paused = false;
        this.renderer.cameraPos = new V2(0.0, 0.0);
        this.renderer.cameraVel = new V2(0.0, 0.0);
    }

    constructor(renderer) {
        this.renderer = renderer;
        this.restart();
    }

    update(dt) {
        if (this.paused) {
            this.renderer.grayness = 1.0;
            return;
        } else {
            this.renderer.grayness = 1.0 - this.player.health / PLAYER_MAX_HEALTH;
        }

        if (this.player.health <= 0.0) {
            dt /= 50;
        }

        this.renderer.setTarget(this.player.pos);
        this.renderer.update(dt);

        let vel = new V2(0, 0);
        let moved = false;
        for (let key of this.pressedKeys) {
            if (key in directionMap) {
                vel = vel.add(directionMap[key]);
                moved = true;
            }
        }
        vel = vel.add(this.movingTouchDirection).normalize().scale(PLAYER_SPEED);
        if (moved) {
            this.tutorial.playerMoved();
        }

        this.player.update(dt, vel);
        if (this.player.shooting) {
            let now = performance.now() / 1000;
            if (now - this.player.lastShoot > this.player.shootCooldown) {
                this.player.lastShoot = now;
                this.tutorial.playerShot();
                this.bullets.push(this.player.shoot());
            }
        }

        this.tutorial.update(dt);

        for (let enemy of this.enemies) {
            if (!enemy.ded) {
                for (let bullet of this.bullets) {
                    if (enemy.pos.dist(bullet.pos) <= BULLET_RADIUS + ENEMY_RADIUS) {
                        this.score += ENEMY_KILL_SCORE;
                        this.player.heal(ENEMY_KILL_HEAL);
                        this.player.accuracy += 1;
                        bullet.lifetime = 0.0;
                        enemy.ded = true;
                        particleBurst(this.particles, enemy.pos, ENEMY_COLOR);
                    }
                }
            }

            if (this.player.health > 0.0 && !enemy.ded) {
                if (enemy.pos.dist(this.player.pos) <= PLAYER_RADIUS + ENEMY_RADIUS) {
                    this.player.damage(ENEMY_DAMAGE);
                    if (this.player.health <= 0.0) {
                        this.player.trail.disabled = true;
                        for (let enemy of this.enemies) {
                            enemy.trail.disabled = true;
                        }
                    }
                    enemy.ded = true;
                    particleBurst(this.particles, enemy.pos, PLAYER_COLOR);
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
            enemy.update(dt, this.player.pos);
        }
        this.enemies = this.enemies.filter(enemy => {
            return !enemy.ded && enemy.pos.dist(this.player.pos) < ENEMY_DESPAWN_DISTANCE;
        });

        if (this.tutorial.state == TutorialState.Finished) {
            this.enemySpawnCooldown -= dt;
            if (this.enemySpawnCooldown <= 0.0) {
                this.spawnEnemy();
                this.enemySpawnCooldown = this.enemySpawnRate;
                this.enemySpawnRate /= ENEMY_SPAWN_GROWTH;
            }
        }
    }

    renderEntities(entities) {
        for (let entity of entities) {
            entity.render(this.renderer);
        }
    }

    render() {
        this.renderer.clear();

        this.renderer.background();
        this.player.render(this.renderer);

        this.renderEntities(this.bullets);
        this.renderEntities(this.particles);
        this.renderEntities(this.enemies);

        if (this.paused) {
            this.renderer.fillMessage("PAUSED (SPACE or touch to resume)", MESSAGE_COLOR);
        } else if(this.player.health <= 0.0) {
            const accuracy = Math.ceil(100 * this.player.accuracy / Math.max(this.player.shootCount, 1.0));
            this.renderer.fillMessage(`YOUR SCORE: ${this.score}\nACCURACY: ${accuracy}%\n(SPACE or touch to restart)`, MESSAGE_COLOR);
        } else {
            this.tutorial.render(this.renderer);
        }

        this.renderer.present();
    }

    spawnEnemy() {
        let dir = randomAngle();
        this.enemies.push(new Enemy(this.player.pos.add(V2.polar(ENEMY_SPAWN_DISTANCE, dir))));
    }

    togglePause() {
        this.paused = !this.paused;
    }

    keyDown(event) {
        if (this.player.health <= 0.0 && event.code == 'Space') {
            this.restart();
            return;
        }

        if (event.code == 'Space') {
            this.togglePause();
        }

        this.pressedKeys.add(event.code);
    }

    keyUp(event) {
        this.pressedKeys.delete(event.code);
    }

    mouseMove(event) {
        if (!this.paused && this.player.shooting) {
            const mousePos = new V2(event.offsetX, event.offsetY);
            this.player.target = this.camera.screenToWorld(mousePos);
        }
    }

    mouseDown(event) {
        if (this.paused) {
            this.paused = false;
            return;
        }

        if (this.player.health <= 0.0) {
            return;
        }
        const mousePos = new V2(event.offsetX, event.offsetY);
        this.player.target = this.renderer.screenToWorld(mousePos)
        this.player.shooting = true;
    }

    mouseUp(event) {
        this.player.shooting = false;
    }

    touchMove(event) {
        Array.from(event.changedTouches).forEach(touch => {
            if (touch.identifier === this.movingTouchId) {
                this.movingTouchDirection = new V2(touch.clientX, touch.clientY).sub(this.movingTouchStart);
            }
            if (touch.identifier === this.shootingTouchId) {
                this.shootingTouchDirection = new V2(touch.clientX, touch.clientY).sub(this.shootingTouchStart).scale(1000);
                this.player.target = this.player.pos.add(this.shootingTouchDirection);
                this.player.shooting = true;
            }
        })
    }

    touchDown(event) {
        event.preventDefault();
        if (this.paused) {
            this.paused = false;
            return;
        }

        if (this.player.health <= 0.0) {
            this.restart();
            return;
        }
        this.tutorial.playerMoved();
        Array.from(event.changedTouches).forEach(touch => {
            if (touch.clientX < window.innerWidth / 2) {
                if (this.movingTouchId === undefined) {
                    this.movingTouchId = touch.identifier;
                    this.movingTouchStart = new V2(touch.clientX, touch.clientY);
                }
            } else {
                if (this.shootingTouchId === undefined) {
                    this.shootingTouchId = touch.identifier;
                    this.shootingTouchStart = new V2(touch.clientX, touch.clientY);
                }
            }
        })
    }

    touchUp(event) {
        Array.from(event.changedTouches).forEach(touch => {
            if (this.movingTouchId === touch.identifier) {
                this.movingTouchId = undefined;
                this.movingTouchDirection = new V2(0.0, 0.0);
            }
            if (this.shootingTouchId === touch.identifier) {
                this.shootingTouchId = undefined;
                this.player.shooting = false;
            }
        });
    }
}

// Resolution at which the game scale will be 1 unit per pixel


let game = null;

(() => {
    const webgl = new URLSearchParams(document.location.search).has("webgl");

    const canvas = document.getElementById("game-canvas");
    const renderer = (() => {
        if (webgl) {
            const gl = canvas.getContext("webgl");
            if (!gl) {
                throw new Error(`Unable to initilize WebGL. Your browser probably does not support that.`);
            }

            const ext = gl.getExtension('ANGLE_instanced_arrays');
            if (!ext) {
                throw new Error(`Unable to initialize Instanced Arrays extension for WebGL. Your browser probably does not support that.`);
            }

            return new RendererWebGL(gl, ext);
        } else {
            return new Renderer2D(canvas.getContext("2d"));
        }
    })();

    let windowWasResized = true;

    game = new Game(renderer);

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
            game.renderer.setViewport(window.innerWidth, window.innerHeight);
            windowWasResized = false;
        }

        game.update(dt);
        game.render();

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

    document.addEventListener('mouseup', event => {
        game.mouseUp(event);
    });

    canvas.addEventListener('touchmove', event => {
        game.touchMove(event);
    });

    canvas.addEventListener('touchstart', event => {
        game.touchDown(event);
    });

    canvas.addEventListener('touchend', event => {
        game.touchUp(event);
    });

    window.addEventListener('resize', event => {
        windowWasResized = true;
    });

    window.addEventListener('blur', event => {
        if (game.player.health > 0.0) {
            game.paused = true;
        }
    });

    window.addEventListener('focus', event => {
        start = performance.now() - 1000 / 60;
    });

    window.addEventListener("orientationchange", (event) => {
        const angle = Math.abs(event.target.screen.orientation.angle);
        if (angle === 90 || angle === 270) {
            document.body.requestFullscreen()
                .catch(error => console.error(`${error.message}. API can only be initiated after user gesture.`));
        } else if (document.fullscreenElement){
            document.exitFullscreen();
        }
    });
})();
