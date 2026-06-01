function toHex(value, type, bytes) {
    if (type === "char") {
        if (value.length !== 1) return "--";
        value = value.charCodeAt(0);
    } else {
        value = Number(value);
        if (isNaN(value)) return "--";
    }

    let maxVal = (1 << (bytes * 8)) - 1;
    if (value > maxVal) return "??";

    return value.toString(16).toUpperCase().padStart(bytes * 2, "0");
}

function update() {
    let canIf = document.getElementById("canIf").value;
    let canAddr = document.getElementById("canAddress").value; // document.getElementById("canAddr").value.toUpperCase().padStart(3, "0");

    let finalHex = "";

    document.querySelectorAll(".field").forEach(f => {
        let type = f.querySelector(".typeSel").value;
        let bytes = Number(f.querySelector(".byteSel").value);
        let value = f.querySelector(".valueIn").value;

        let hex = toHex(value, type, bytes);
        f.querySelector(".hexBox").textContent = hex;
        finalHex += hex;
    });

    document.getElementById("output").textContent =
        `cansend ${canIf} ${canAddr}#${finalHex}`;
}

function addField() {
    let div = document.createElement("div");
    div.className = "field d-flex align-items-center gap-2 mb-2";

    div.innerHTML = `
        <select class="typeSel form-select form-select-sm w-auto" onchange="update()">
            <option value="char">Char</option>
            <option value="num">Number</option>
        </select>

        <select class="byteSel form-select form-select-sm w-auto" onchange="update()">
            ${[1,2,3,4,5,6,7,8]
                .map(b => `<option value="${b}">${b} byte</option>`)
                .join("")}
        </select>

        <input class="valueIn form-control form-control-sm w-auto"
               placeholder="value" oninput="update()">

        <div class="hexBox rounded">
            --
        </div>

        <button class="removeBtn btn btn-danger btn-sm"
                onclick="this.parentNode.remove(); update()">
            X
        </button>
    `;

    document.getElementById("fields").appendChild(div);
}

