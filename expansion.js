// File: expansion.js

export function createExpansion(THREE, api) {
  const L = 20;
  const PERIOD = 40;
  const FLOOR_GAP = 4.8;
  const ROOM_HEIGHT = 2.9;
  const PLAYER_RADIUS = 0.16;
  const DRAW_RADIUS = 110;
  
  const HORIZONTAL_SCALE = 6;

  const SHAFT_HALF_X = 1.4;
  const SHAFT_HALF_Z = 1.65;
  const SHAFT_DOOR_HALF = 0.55;
  const SHAFT_GATE_X = SHAFT_HALF_X - 0.08;

  const COLORS = {
    blue: "#236bc2",
    green: "#248653",
    yellow: "#d9a426",
    purple: "#914bab"
  };

  const root = new THREE.Group();
  root.scale.set(HORIZONTAL_SCALE, 1, HORIZONTAL_SCALE);
  api.scene.add(root);

  let enabled = false;
  let stageNumber = 0;
  let kind = "";
  let periodX = PERIOD;
  let periodZ = PERIOD;
  let level = 0;

  let layers = [];
  let floorLabels = [];
  let pillarLabels = [];
  let obstacles = [];
  let logicalLetters = new Set();
  let textMaterials = new Map();

  let stairGroup = null;
  let stairTrip = null;

  let travelSign = 1;

  let pendingEntrance = null;
  let stairDoorSide = -1;
  let shaftVisuals = [];

  const connections = [
    {
      upper: "C",
      lower: "G",
      x: L / 2,
      z: -L / 2
    },
    {
      upper: "D",
      lower: "H",
      x: -L / 2,
      z: L / 2
    }
  ];

  function reset() {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();

    root.traverse((object) => {
      if (object.geometry) {
        geometries.add(object.geometry);
      }

      if (object.material) {
        const list = Array.isArray(object.material)
          ? object.material
          : [object.material];

        for (const material of list) {
          materials.add(material);

          if (material.map) {
            textures.add(material.map);
          }
        }
      }
    });

    for (const geometry of geometries) {
      geometry.dispose();
    }

    for (const material of materials) {
      material.dispose();
    }

    for (const texture of textures) {
      texture.dispose();
    }

    root.clear();

    enabled = false;
    stageNumber = 0;
    kind = "";
    layers = [];
    floorLabels = [];
    pillarLabels = [];
    obstacles = [];
    logicalLetters = new Set();
    textMaterials = new Map();
    stairGroup = null;
    stairTrip = null;

    travelSign = 1;

    pendingEntrance = null;
    stairDoorSide = -1;
    shaftVisuals = [];
  }

  function material(color, extra = {}) {
    return new THREE.MeshBasicMaterial({
      color,
      ...extra
    });
  }

  function box(parent, x, y, z, sx, sy, sz, mat) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx, sy, sz),
      mat
    );

    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  function quad(parent, points, mat) {
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        points.flat(),
        3
      )
    );

    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, mat);
    parent.add(mesh);
    return mesh;
  }

  function registerLetter(letter) {
    if (logicalLetters.has(letter)) {
      throw new Error(
        `追加ステージで ${letter} が重複登録されています。`
      );
    }

    logicalLetters.add(letter);
  }

  function wrap(value, period) {
    return (
      ((value + period / 2) % period + period) % period
    ) - period / 2;
  }

  function periodicDistance(x, z, point) {
    const dx = wrap(x - point.x, periodX);
    const dz = wrap(z - point.z, periodZ);
    return Math.hypot(dx, dz);
  }

  /*
   * 描画用の複製。
   *
   * 同じ文字が複数見えても、別の地点ではない。
   * 周期座標・折り畳み座標における同じ地点の別表示。
   */
  function repeatPositions(points, callback) {
    const nx = Math.ceil(80 / periodX) + 1;
    const nz = Math.ceil(80 / periodZ) + 1;

    for (let ix = -nx; ix <= nx; ix++) {
      for (let iz = -nz; iz <= nz; iz++) {
        for (const point of points) {
          callback(
            point.x + ix * periodX,
            point.z + iz * periodZ
          );
        }
      }
    }
  }

  /*
   * 床に描く路線のテクスチャ。
   *
   * sphere:
   *   横線の向きは行ごとに反転。
   *   縦線の向きは列ごとに反転。
   *
   * torus:
   *   横線はすべて右向き。
   *   緑は上向き、黄色は下向き。
   */
  function gridTexture(horizontalColor, verticalColor) {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = Math.round(
      canvas.width * periodZ / periodX
    );

    const g = canvas.getContext("2d");
    const scaleX = canvas.width / periodX;
    const scaleZ = canvas.height / periodZ;

    g.fillStyle = "#a2a89a";
    g.fillRect(0, 0, canvas.width, canvas.height);

    function line(x0, z0, x1, z1, color, width) {
      g.strokeStyle = color;
      g.lineWidth = width * scaleX;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(x0 * scaleX, z0 * scaleZ);
      g.lineTo(x1 * scaleX, z1 * scaleZ);
      g.stroke();
    }

    function arrow(x, z, dx, dz, color) {
      const length = 0.34;
      const width = 0.22;
      const px = -dz;
      const pz = dx;

      const tipX = x + dx * length;
      const tipZ = z + dz * length;
      const backX = x - dx * length;
      const backZ = z - dz * length;

      line(
        backX + px * width,
        backZ + pz * width,
        tipX,
        tipZ,
        color,
        0.075
      );

      line(
        backX - px * width,
        backZ - pz * width,
        tipX,
        tipZ,
        color,
        0.075
      );
    }

    // 路線とは別の、薄い床タイルの目地。
    for (let x = 0; x <= periodX; x++) {
      line(
        x,
        0,
        x,
        periodZ,
        "rgba(67, 81, 69, 0.15)",
        0.012
      );
    }

    for (let z = 0; z <= periodZ; z++) {
      line(
        0,
        z,
        periodX,
        z,
        "rgba(67, 81, 69, 0.15)",
        0.012
      );
    }

    if (kind === "sphere") {
      for (let row = 0; row <= 2; row++) {
        const z = row * L;
        const direction = row % 2 === 0 ? 1 : -1;

        line(
          0,
          z,
          periodX,
          z,
          horizontalColor,
          0.10
        );

        for (let x = 2; x < periodX; x += 4) {
          arrow(x, z, direction, 0, horizontalColor);
        }
      }

      for (let column = 0; column <= 2; column++) {
        const x = column * L;
        const direction = column % 2 === 0 ? -1 : 1;

        line(
          x,
          0,
          x,
          periodZ,
          verticalColor,
          0.10
        );

        for (let z = 2; z < periodZ; z += 4) {
          arrow(x, z, 0, direction, verticalColor);
        }
      }
    } else {
      for (const z of [0, periodZ]) {
        line(
          0,
          z,
          periodX,
          z,
          COLORS.blue,
          0.10
        );

        for (let x = 3; x < periodX; x += 6) {
          arrow(x, z, 1, 0, COLORS.blue);
        }
      }

      for (const x of [0, periodX]) {
        line(
          x,
          0,
          x,
          periodZ,
          COLORS.green,
          0.10
        );

        for (let z = 2; z < periodZ; z += 4) {
          arrow(x, z, 0, -1, COLORS.green);
        }
      }

      line(
        periodX / 2,
        0,
        periodX / 2,
        periodZ,
        COLORS.yellow,
        0.10
      );

      for (let z = 2; z < periodZ; z += 4) {
        arrow(
          periodX / 2,
          z,
          0,
          1,
          COLORS.yellow
        );
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 2;

    return texture;
  }

  function makeSurfaceFloorGeometry() {
    if (stageNumber !== 10) {
      return new THREE.PlaneGeometry(
        DRAW_RADIUS * 2,
        DRAW_RADIUS * 2
      );
    }

    const shape = new THREE.Shape();

    shape.moveTo(-DRAW_RADIUS, -DRAW_RADIUS);
    shape.lineTo(DRAW_RADIUS, -DRAW_RADIUS);
    shape.lineTo(DRAW_RADIUS, DRAW_RADIUS);
    shape.lineTo(-DRAW_RADIUS, DRAW_RADIUS);
    shape.closePath();

    /*
     * 各階の階段室の領域を床から除く。
     *
     * 周期表示上は複数見えるが、
     * 球面の同一視を考慮すると各階に2つの穴。
     */
    repeatPositions(connections, (x, z) => {
      if (
        Math.abs(x) + SHAFT_HALF_X >= DRAW_RADIUS
        || Math.abs(z) + SHAFT_HALF_Z >= DRAW_RADIUS
      ) {
        return;
      }

      // 平面を横に寝かせるため、local-y = -world-z。
      const y = -z;
      const hole = new THREE.Path();

      hole.moveTo(
        x - SHAFT_HALF_X,
        y - SHAFT_HALF_Z
      );

      hole.lineTo(
        x - SHAFT_HALF_X,
        y + SHAFT_HALF_Z
      );

      hole.lineTo(
        x + SHAFT_HALF_X,
        y + SHAFT_HALF_Z
      );

      hole.lineTo(
        x + SHAFT_HALF_X,
        y - SHAFT_HALF_Z
      );

      hole.closePath();
      shape.holes.push(hole);
    });

    return new THREE.ShapeGeometry(shape);
  }

  function makeLayer(index, horizontalColor, verticalColor) {
    const group = new THREE.Group();
    group.position.y = index * FLOOR_GAP;
    root.add(group);
    layers[index] = group;

    const geometry = makeSurfaceFloorGeometry();
    const positions = geometry.getAttribute("position");

    if (!geometry.getAttribute("uv")) {
      geometry.setAttribute(
        "uv",
        new THREE.BufferAttribute(
          new Float32Array(positions.count * 2),
          2
        )
      );
    }

    const uvs = geometry.getAttribute("uv");

    for (let i = 0; i < positions.count; i++) {
      uvs.setXY(
        i,
        positions.getX(i) / periodX,
        positions.getY(i) / periodZ
      );
    }

    uvs.needsUpdate = true;

    const floor = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: gridTexture(horizontalColor, verticalColor)
      })
    );

    floor.rotation.x = -Math.PI / 2;
    group.add(floor);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(
        DRAW_RADIUS * 2,
        DRAW_RADIUS * 2
      ),
      material("#c3cbc5")
    );

    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = ROOM_HEIGHT;
    group.add(ceiling);

    return group;
  }

  function textMaterial(text) {
    if (textMaterials.has(text)) {
      return textMaterials.get(text);
    }

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;

    const g = canvas.getContext("2d");
    g.fillStyle = "#f4dc60";
    g.fillRect(0, 0, 512, 256);

    g.strokeStyle = "#303b2d";
    g.lineWidth = 10;
    g.strokeRect(5, 5, 502, 246);

    g.fillStyle = "#111810";
    g.textAlign = "center";
    g.textBaseline = "middle";

    const lines = text.split("\n");

    if (lines.length === 1) {
      g.font = "bold 180px sans-serif";
      g.fillText(text, 256, 138, 470);
    } else {
      g.font = "bold 120px sans-serif";
      g.fillText(lines[0], 256, 83, 470);
      g.font = "bold 62px sans-serif";
      g.fillText(lines[1], 256, 196, 470);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;

    const mat = new THREE.MeshBasicMaterial({
      map: texture
    });

    textMaterials.set(text, mat);
    return mat;
  }

  function floorCopies(
    group,
    points,
    text,
    width = 0.90,
    depth = 0.62
  ) {
    const geometry = new THREE.PlaneGeometry(width, depth);
    const mat = textMaterial(text);

    repeatPositions(points, (x, z) => {
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.position.set(x, 0.025, z);
      mesh.rotation.x = -Math.PI / 2;
      group.add(mesh);

      floorLabels.push({
        mesh,
        x,
        z,
        parent: group
      });
    });
  }

  function addFloorLetter(group, letter, points) {
    registerLetter(letter);
    floorCopies(group, points, letter);
  }

  function addPillar(group, letter, point) {
    registerLetter(letter);

    const radius = 0.60;

    obstacles.push({
      x: point.x,
      z: point.z,
      radius
    });

    const geometry = new THREE.CylinderGeometry(
      radius,
      radius,
      ROOM_HEIGHT,
      24
    );

    const mat = material("#aeb8af");
    const labelGeometry = new THREE.PlaneGeometry(0.48, 0.36);
    const labelMaterial = textMaterial(letter);

    repeatPositions([point], (x, z) => {
      const pillar = new THREE.Mesh(geometry, mat);
      pillar.position.set(x, ROOM_HEIGHT / 2, z);
      group.add(pillar);

      const label = new THREE.Mesh(
        labelGeometry,
        labelMaterial
      );

      label.position.y = 1.75;
      group.add(label);

      pillarLabels.push({
        mesh: label,
        x,
        z,
        radius,
        parent: group
      });
    });
  }

  function sphereLetters(group, punctured) {
    const points = {
      A: [
        { x: 0, z: 0 },
        { x: L, z: L }
      ],
      B: [
        { x: L / 2, z: 0 },
        { x: L / 2, z: L }
      ],
      C: [
        { x: L, z: 0 },
        { x: 0, z: L }
      ],
      D: [
        { x: -L / 2, z: 0 },
        { x: -L / 2, z: L }
      ],
      E: [
        { x: 0, z: -L / 2 },
        { x: L, z: -L / 2 }
      ],
      F: [
        { x: 0, z: L / 2 },
        { x: L, z: L / 2 }
      ],
      G: [
        { x: L / 2, z: -L / 2 }
      ],
      H: [
        { x: -L / 2, z: L / 2 }
      ]
    };

    for (const [letter, positions] of Object.entries(points)) {
      if (punctured && (letter === "G" || letter === "H")) {
        addPillar(group, letter, positions[0]);
      } else {
        addFloorLetter(group, letter, positions);
      }
    }
  }

  function torusLetters(group, punctured) {
    const points = {
      A: [{ x: 0, z: 0 }],
      B: [{ x: 6, z: 0 }],
      C: [{ x: 12, z: 0 }],
      D: [{ x: 18, z: 0 }],
      E: [{ x: 24, z: 0 }],
      F: [{ x: 30, z: 0 }],
      G: [{ x: 0, z: -10 }],
      H: [{ x: 18, z: 10 }]
    };

    for (const [letter, positions] of Object.entries(points)) {
      if (punctured && letter === "B") {
        addPillar(group, "B", {
          x: 6,
          z: -1.8
        });
      } else {
        addFloorLetter(group, letter, positions);
      }
    }
  }

  /*
   * 繰り返し表示する階段室の描画負荷を抑えるため、
   * 同じ材質の静的メッシュをまとめる。
   */
  function compactStaticGroup(source) {
    source.updateMatrixWorld(true);

    const batches = new Map();
    const oldGeometries = new Set();

    source.traverse((object) => {
      if (!object.isMesh) {
        return;
      }

      oldGeometries.add(object.geometry);

      const geometry = object.geometry.index
        ? object.geometry.toNonIndexed()
        : object.geometry.clone();

      geometry.applyMatrix4(object.matrixWorld);

      const positions = geometry.getAttribute("position");
      const uvs = geometry.getAttribute("uv");

      if (!batches.has(object.material)) {
        batches.set(object.material, {
          positions: [],
          uvs: []
        });
      }

      const batch = batches.get(object.material);

      for (let i = 0; i < positions.count; i++) {
        batch.positions.push(
          positions.getX(i),
          positions.getY(i),
          positions.getZ(i)
        );

        batch.uvs.push(
          uvs ? uvs.getX(i) : 0,
          uvs ? uvs.getY(i) : 0
        );
      }

      geometry.dispose();
    });

    const result = new THREE.Group();

    for (const [mat, batch] of batches) {
      const geometry = new THREE.BufferGeometry();

      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          batch.positions,
          3
        )
      );

      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(
          batch.uvs,
          2
        )
      );

      geometry.computeBoundingSphere();

      result.add(new THREE.Mesh(geometry, mat));
    }

    for (const geometry of oldGeometries) {
      geometry.dispose();
    }

    return result;
  }

  function makeEntrancePrototype(letter, descending) {
    const group = new THREE.Group();

    const wallMat = material("#b4beb5");
    const stepMat = material("#87968c");
    const edgeMat = material("#425b64");
    const darkMat = material("#263b40");

    const doorTop = 2.35;
    const thickness = 0.10;

    // 通路に平行な2面。
    for (const z of [-SHAFT_HALF_Z, SHAFT_HALF_Z]) {
      box(
        group,
        0,
        ROOM_HEIGHT / 2,
        z,
        SHAFT_HALF_X * 2,
        ROOM_HEIGHT,
        thickness,
        wallMat
      );
    }

    /*
     * 両側の入口は、球面の半回転同一視による
     * 同じ入口の2つの座標表示。
     */
    for (const side of [-1, 1]) {
      const x = side * SHAFT_HALF_X;

      for (const zSide of [-1, 1]) {
        box(
          group,
          x,
          ROOM_HEIGHT / 2,
          zSide * (
            SHAFT_HALF_Z + SHAFT_DOOR_HALF
          ) / 2,
          thickness,
          ROOM_HEIGHT,
          SHAFT_HALF_Z - SHAFT_DOOR_HALF,
          wallMat
        );
      }

      // 入口の上の壁。
      box(
        group,
        x,
        (doorTop + ROOM_HEIGHT) / 2,
        0,
        thickness,
        ROOM_HEIGHT - doorTop,
        SHAFT_DOOR_HALF * 2,
        wallMat
      );

      // 入口直後の短い平らな床。
      box(
        group,
        side * (SHAFT_HALF_X - 0.16),
        -0.07,
        0,
        0.32,
        0.14,
        SHAFT_DOOR_HALF * 2,
        stepMat
      );

      // 外から見える階段の最初の数段。
      const count = 6;
      const run = SHAFT_HALF_X - 0.38;

      for (let i = 0; i < count; i++) {
        const top = (i + 1) * 0.12
          * (descending ? -1 : 1);

        const stepX = side * (
          SHAFT_HALF_X
          - 0.32
          - (i + 0.5) * run / count
        );

        box(
          group,
          stepX,
          top - 0.09,
          0,
          run / count + 0.01,
          0.18,
          SHAFT_DOOR_HALF * 2,
          stepMat
        );

        box(
          group,
          side * (
            SHAFT_HALF_X
            - 0.32
            - i * run / count
          ),
          top + 0.004,
          0,
          0.025,
          0.012,
          SHAFT_DOOR_HALF * 2,
          edgeMat
        );
      }

      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(
          0.9 / HORIZONTAL_SCALE,
          0.44
        ),
        textMaterial(
          `${letter}\n${descending ? "下り" : "上り"}`
        )
      );

      label.position.set(
        side * (SHAFT_HALF_X + 0.055),
        2.61,
        0
      );

      label.rotation.y = side * Math.PI / 2;
      group.add(label);
    }

    // 階段室の内部を奥まで透かして見せないための壁。
    box(
      group,
      0,
      (ROOM_HEIGHT - 0.9) / 2,
      0,
      0.10,
      ROOM_HEIGHT + 0.9,
      SHAFT_HALF_Z * 2,
      darkMat
    );

    // 上面は歩行面として登録しない。
    box(
      group,
      0,
      ROOM_HEIGHT - 0.04,
      0,
      SHAFT_HALF_X * 2,
      0.08,
      SHAFT_HALF_Z * 2,
      wallMat
    );

    return compactStaticGroup(group);
  }

  function addPortal(group, letter, point) {
    registerLetter(letter);

    const descending = group === layers[1];
    const prototype = makeEntrancePrototype(
      letter,
      descending
    );

    repeatPositions([point], (x, z) => {
      const entrance = prototype.clone(true);
      entrance.position.set(x, 0, z);
      group.add(entrance);

      shaftVisuals.push({
        object: entrance,
        parent: group,
        x,
        z
      });
    });
  }

  /*
   * ⑩の階段専用区間。
   *
   * 同じ形状を2本の階段で共用するが、
   * stairTrip が接続先を区別する。
   *
   * 下側の踊り場: z = 0 ～ 2
   * 階段:         z = -8 ～ 0
   * 上側の踊り場: z = -10 ～ -8
   */
  function buildStairZone() {
    stairGroup = new THREE.Group();
    stairGroup.visible = false;
    root.add(stairGroup);

    const floorMat = material("#9aa69c");
    const wallMat = material("#c2ccc4", {
      side: THREE.DoubleSide
    });
    const ceilingMat = material("#a9b6ad", {
      side: THREE.DoubleSide
    });
    const edgeMat = material("#52636a");

    box(
      stairGroup,
      0,
      -0.08,
      1,
      2,
      0.16,
      2,
      floorMat
    );

    box(
      stairGroup,
      0,
      FLOOR_GAP - 0.08,
      -9,
      2,
      0.16,
      2,
      floorMat
    );

    const steps = 32;

    for (let i = 0; i < steps; i++) {
      const top = FLOOR_GAP * (i + 1) / steps;
      const z = -(i + 0.5) * 8 / steps;

      box(
        stairGroup,
        0,
        top - 0.15,
        z,
        2,
        0.30,
        8 / steps + 0.01,
        floorMat
      );

      box(
        stairGroup,
        0,
        top + 0.005,
        -i * 8 / steps,
        2,
        0.012,
        0.035,
        edgeMat
      );
    }

    const sections = [
      { z: 2, y: 0 },
      { z: 0, y: 0 },
      { z: -8, y: FLOOR_GAP },
      { z: -10, y: FLOOR_GAP }
    ];

    for (let i = 0; i < sections.length - 1; i++) {
      const a = sections[i];
      const b = sections[i + 1];

      for (const x of [-1, 1]) {
        quad(
          stairGroup,
          [
            [x, a.y, a.z],
            [x, b.y, b.z],
            [x, b.y + 2.8, b.z],
            [x, a.y + 2.8, a.z]
          ],
          wallMat
        );
      }

      quad(
        stairGroup,
        [
          [-1, a.y + 2.8, a.z],
          [1, a.y + 2.8, a.z],
          [1, b.y + 2.8, b.z],
          [-1, b.y + 2.8, b.z]
        ],
        ceilingMat
      );
    }

    const doorMat = material("#30444e");

    box(
      stairGroup,
      0,
      1.4,
      2.01,
      2,
      2.8,
      0.04,
      doorMat
    );

    box(
      stairGroup,
      0,
      FLOOR_GAP + 1.4,
      -10.01,
      2,
      2.8,
      0.04,
      doorMat
    );
  }

  function buildTen() {
    const lower = makeLayer(
      0,
      COLORS.yellow,
      COLORS.purple
    );

    const upper = makeLayer(
      1,
      COLORS.blue,
      COLORS.green
    );

    const first = [
      { x: 0, z: 0 },
      { x: L, z: L }
    ];

    const second = [
      { x: L, z: 0 },
      { x: 0, z: L }
    ];

    addFloorLetter(upper, "A", first);
    addFloorLetter(upper, "B", second);
    addFloorLetter(lower, "E", first);
    addFloorLetter(lower, "F", second);

    for (const connection of connections) {
      addPortal(
        upper,
        connection.upper,
        connection
      );

      addPortal(
        lower,
        connection.lower,
        connection
      );
    }

    buildStairZone();
  }

  function build(number) {
    enabled = true;
    stageNumber = number;
    kind = [6, 9].includes(number) ? "torus" : "sphere";

    periodX = kind === "torus" ? 36 : PERIOD;
    periodZ = kind === "torus" ? 20 : PERIOD;
    level = number === 10 ? 1 : 0;

    if (number === 10) {
      buildTen();
    } else {
      const group = makeLayer(
        0,
        COLORS.blue,
        COLORS.green
      );

      if (kind === "sphere") {
        sphereLetters(group, number === 8);
      } else {
        torusLetters(group, number === 9);
      }
    }

    if (
      [...logicalLetters].sort().join("") !== "ABCDEFGH"
    ) {
      throw new Error(
        "追加ステージのA〜Hの登録が一致しません。"
      );
    }

    return {
      x: -3.2,
      z: 0.7,
      foot: level * FLOOR_GAP,
      yaw: Math.PI / 2,
      floor: number === 10 ? "2F" : "1F"
    };
  }

  /*
   * 球面の座標同一視。
   *
   * x,z はそれぞれ2L周期。
   * さらに (x,z) と (L-x,L-z) を同一視する。
   *
   * 半回転の微分に合わせて視線もπ回転する。
   * 単なるトーラスの周期境界とは異なる。
   */
  function normalize(state) {
    state.x = wrap(state.x, periodX);
    state.z = wrap(state.z, periodZ);

    if (
      kind === "sphere"
      && (
        state.x > L / 2
        || state.x < -L / 2
      )
    ) {
      state.x = wrap(L - state.x, PERIOD);
      state.z = wrap(L - state.z, PERIOD);
      state.yaw += Math.PI;
    }

    state.yaw = Math.atan2(
      Math.sin(state.yaw),
      Math.cos(state.yaw)
    );
  }

  function stairHeight(z) {
    if (z >= 0) {
      return 0;
    }

    if (z <= -8) {
      return FLOOR_GAP;
    }

    return -z * FLOOR_GAP / 8;
  }

  function canStandSurface(x, z) {
    for (const obstacle of obstacles) {
      if (
        periodicDistance(x, z, obstacle)
        < obstacle.radius + PLAYER_RADIUS
      ) {
        return false;
      }
    }

    return true;
  }

  function checkShaftMovement(x, z, moveX) {
    for (let index = 0; index < connections.length; index++) {
      const connection = connections[index];

      const dx = wrap(
        x - connection.x,
        periodX
      );

      const dz = wrap(
        z - connection.z,
        periodZ
      );

      const ax = Math.abs(dx);
      const az = Math.abs(dz);

      if (
        ax > SHAFT_HALF_X + PLAYER_RADIUS
        || az > SHAFT_HALF_Z + PLAYER_RADIUS
      ) {
        continue;
      }

      const insideDoorWidth =
        az <= SHAFT_DOOR_HALF - PLAYER_RADIUS;

      if (insideDoorWidth) {
        // 入口の外側から、敷居までは進める。
        if (ax > SHAFT_GATE_X) {
          continue;
        }

        // 敷居を内向きにまたいだ場合だけ階段へ入る。
        if (
          ax >= SHAFT_GATE_X - 0.04
          && dx * moveX < 0
        ) {
          return {
            blocked: false,
            entrance: index,
            side: dx >= 0 ? 1 : -1
          };
        }
      }

      // 入口以外から階段室の領域には入れない。
      return {
        blocked: true,
        entrance: null
      };
    }

    return {
      blocked: false,
      entrance: null
    };
  }

  function planMove(state, distance) {
    travelSign = distance < 0 ? -1 : 1;

    const dx = Math.sin(state.yaw) * travelSign;
    const dz = -Math.cos(state.yaw) * travelSign;

    pendingEntrance = null;

    const path = [{
      x: state.x,
      z: state.z,
      foot: state.foot,
      floor: state.floor
    }];

    for (let i = 1; i <= 65; i++) {
      const d = Math.abs(distance) * i / 65;
      const x = state.x + dx * d;
      const z = state.z + dz * d;

      if (stairTrip !== null) {
        if (
          Math.abs(x) > 1 - PLAYER_RADIUS
          || z < -10 + PLAYER_RADIUS
          || z > 2 - PLAYER_RADIUS
        ) {
          break;
        }

        path.push({
          x,
          z,
          foot: stairHeight(z),
          floor: state.floor
        });

        continue;
      }

      if (!canStandSurface(x, z)) {
        break;
      }

      let contact = null;

      if (stageNumber === 10) {
        contact = checkShaftMovement(x, z, dx);

        if (contact.blocked) {
          break;
        }
      }

      path.push({
        x,
        z,
        foot: level * FLOOR_GAP,
        floor: level === 1 ? "2F" : "1F"
      });

      if (
        contact
        && contact.entrance !== null
      ) {
        pendingEntrance = {
          index: contact.entrance,
          side: contact.side
        };

        break;
      }
    }

    return path;
  }

  function enterStair(state, index, side) {
    const connection = connections[index];

    stairTrip = index;
    stairDoorSide = side;
    pendingEntrance = null;

    state.x = 0;
    state.z = level === 1 ? -9.2 : 1.2;
    state.foot = level * FLOOR_GAP;
    state.yaw =
      (level === 1 ? Math.PI : 0)
      + (travelSign < 0 ? Math.PI : 0);

    state.floor =
      `階段 ${connection.upper} ↔ ${connection.lower}`;

    api.notify(
      `${connection.upper} ↔ ${connection.lower} の階段`
    );
  }

  function leaveStair(state, destinationLevel) {
    const connection = connections[stairTrip];
    const side = stairDoorSide;

    level = destinationLevel;
    stairTrip = null;
    pendingEntrance = null;

    // 相手側の入口の外へ出る。
    state.x = connection.x
      + side * (SHAFT_HALF_X + 0.65);

    state.z = connection.z;
    state.foot = level * FLOOR_GAP;
    state.yaw =
      (side > 0 ? Math.PI / 2 : -Math.PI / 2)
      + (travelSign < 0 ? Math.PI : 0);
    state.floor = level === 1 ? "2F" : "1F";

    normalize(state);

    const letter = level === 1
      ? connection.upper
      : connection.lower;

    api.notify(`${letter} の入口から出ました。`);
  }

  function settle(state) {
    if (!enabled) {
      return;
    }

    if (stairTrip !== null) {
      if (state.z >= 1.75) {
        leaveStair(state, 0);
      } else if (state.z <= -9.75) {
        leaveStair(state, 1);
      }

      return;
    }

    normalize(state);

    if (
      stageNumber === 10
      && pendingEntrance !== null
    ) {
      const entrance = pendingEntrance;
      pendingEntrance = null;

      enterStair(
        state,
        entrance.index,
        entrance.side
      );
    }
  }

  function prepareFrame(state) {
    if (!enabled) {
      return;
    }

    for (let i = 0; i < layers.length; i++) {
      layers[i].visible =
        stairTrip === null && i === level;
    }

    if (stairGroup) {
      stairGroup.visible = stairTrip !== null;
    }

    for (const visual of shaftVisuals) {
      const dx = visual.x - state.x;
      const dz = visual.z - state.z;

      visual.object.visible =
        visual.parent.visible
        && dx * dx + dz * dz < 70 * 70;
    }

    if (stairTrip !== null) {
      return;
    }

    for (const label of floorLabels) {
      const dx = label.x - state.x;
      const dz = label.z - state.z;

      label.mesh.visible =
        label.parent.visible
        && dx * dx + dz * dz < 65 * 65;

      label.mesh.rotation.set(
        -Math.PI / 2,
        0,
        -state.yaw
      );
    }

    for (const label of pillarLabels) {
      const dx = state.x - label.x;
      const dz = state.z - label.z;

      const distance = Math.max(
        0.001,
        Math.hypot(dx, dz)
      );

      label.mesh.visible =
        label.parent.visible && distance < 65;

      label.mesh.position.set(
        label.x + dx / distance * (label.radius + 0.018),
        1.75,
        label.z + dz / distance * (label.radius + 0.018)
      );

      label.mesh.rotation.y = Math.atan2(dx, dz);

      // 縦の看板は、横方向だけに引き伸ばされないよう補正。
      label.mesh.scale.set(
        1 / HORIZONTAL_SCALE,
        1,
        1
      );
    }
  }

  /*
   * ステージ⑦は通常の3D空間として、
   * index.html 側の壁・床・階段・衝突判定を使う。
   */
  function buildSeven() {
    const {
      floorRect,
      ceilingRect,
      boundary,
      wallLine,
      stairFlight,
      wallSign,
      countStair
    } = api;

    function walls(x0, z0, x1, z1, y, doors = {}) {
      boundary(
        "x", x0, z0, z1, y, 2.9,
        doors.west || []
      );

      boundary(
        "x", x1, z0, z1, y, 2.9,
        doors.east || []
      );

      boundary(
        "z", z0, x0, x1, y, 2.9,
        doors.north || []
      );

      boundary(
        "z", z1, x0, x1, y, 2.9,
        doors.south || []
      );
    }

    function door(center) {
      return [center - 0.69, center + 0.69];
    }

    function room(x0, z0, x1, z1, y, label, doors) {
      floorRect(x0, z0, x1, z1, y, label);
      ceilingRect(x0, z0, x1, z1, y + 2.9);
      walls(x0, z0, x1, z1, y, doors);
    }

    // 1F: 壁に囲まれた回廊。
    const ringParts = [
      [-8, -5, 8, -2],
      [-8, 2, 8, 5],
      [-8, -2, -5, 2],
      [5, -2, 8, 2]
    ];

    for (const [x0, z0, x1, z1] of ringParts) {
      floorRect(x0, z0, x1, z1, 0, "1F · 回廊");
      ceilingRect(x0, z0, x1, z1, 2.9);
    }

    walls(-8, -5, 8, 5, 0, {
      west: [door(3.25)],
      east: [door(-2.1)]
    });

    walls(-5, -2, 5, 2, 0);

    // 2F。
    room(-8, -5, 8, 5, 4, "2F", {
      west: [
        door(1.95),
        door(-1.95)
      ],
      east: [door(0)]
    });

    // 外壁に接続した突き出し壁。独立した穴は作らない。
    wallLine(
      { x: -1, z: -5 },
      { x: -1, z: -1 },
      4,
      2.9
    );

    wallLine(
      { x: 1, z: 5 },
      { x: 1, z: 1 },
      4,
      2.9
    );

    // 3F: 右側の小さい正方形。
    room(24, -3, 30, 3, 8, "3F", {
      west: [
        door(-2.1),
        door(0),
        door(2.1)
      ]
    });

    // 4F。
    room(-8, -5, 8, 5, 12, "4F", {
      west: [door(-3.25)],
      east: [door(2.1)]
    });

    function westU(
      centerZ,
      bottom,
      top,
      run
    ) {
      const edge = -8;
      const turnX = edge - run;
      const endX = turnX - 1.3;
      const middle = (bottom + top) / 2;

      stairFlight(
        {
          x: edge,
          z: centerZ + 0.65,
          y: bottom
        },
        {
          x: turnX,
          z: centerZ + 0.65,
          y: middle
        },
        1.2,
        "階段"
      );

      floorRect(
        endX,
        centerZ - 1.25,
        turnX,
        centerZ + 1.25,
        middle,
        "踊り場"
      );

      ceilingRect(
        endX,
        centerZ - 1.25,
        turnX,
        centerZ + 1.25,
        middle + 2.9
      );

      stairFlight(
        {
          x: turnX,
          z: centerZ - 0.65,
          y: middle
        },
        {
          x: edge,
          z: centerZ - 0.65,
          y: top
        },
        1.2,
        "階段"
      );

      const height = top - bottom + 2.9;

      wallLine(
        { x: endX, z: centerZ - 1.32 },
        { x: endX, z: centerZ + 1.32 },
        bottom,
        height
      );

      for (const z of [
        centerZ - 1.32,
        centerZ + 1.32
      ]) {
        wallLine(
          { x: edge, z },
          { x: endX, z },
          bottom,
          height
        );
      }

      ceilingRect(
        endX,
        centerZ - 1.32,
        edge,
        centerZ + 1.32,
        top + 2.9
      );

      countStair();
    }

    // A ↔ C。
    westU(2.6, 0, 4, 3.6);

    // D ↔ H。
    westU(-2.6, 4, 12, 6.2);

    // B ↔ F。
    stairFlight(
      { x: 8, z: -2.1, y: 0 },
      { x: 24, z: -2.1, y: 8 },
      1.3,
      "階段 · 1F ↔ 3F"
    );

    countStair();

    // E ↔ F。
    stairFlight(
      { x: 8, z: 0, y: 4 },
      { x: 24, z: 0, y: 8 },
      1.3,
      "階段 · 2F ↔ 3F"
    );

    countStair();

    // F ↔ G。
    stairFlight(
      { x: 24, z: 2.1, y: 8 },
      { x: 8, z: 2.1, y: 12 },
      1.3,
      "階段 · 3F ↔ 4F"
    );

    countStair();

    wallSign("A", "west", -8, 3.25, 2.62);
    wallSign("B", "east", 8, -2.1, 2.62);
    wallSign("C", "west", -8, 1.95, 6.62);
    wallSign("D", "west", -8, -1.95, 6.62);
    wallSign("E", "east", 8, 0, 6.62);
    wallSign("F", "north", -3, 27, 9.85);
    wallSign("G", "east", 8, 2.1, 14.62);
    wallSign("H", "west", -8, -3.25, 14.62);

    return {
      x: -6.9,
      z: 3.25,
      foot: 0,
      yaw: 0,
      floor: "1F · 回廊"
    };
  }

  return {
    get active() {
      return enabled;
    },
    get horizontalScale() {
      return enabled ? HORIZONTAL_SCALE : 1;
    },
    reset,
    build,
    buildSeven,
    planMove,
    settle,
    prepareFrame
  };
}
