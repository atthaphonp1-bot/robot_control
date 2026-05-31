// Function to calculate and set the target pulse (current pulse + offset)
function setTargetPulse(motor, pulse_label, result_label) {
    const pulse = parseFloat(document.getElementById(`${pulse_label.toLowerCase()}-pulse-${motor.toLowerCase()}`).value);
    const offset = parseFloat(document.getElementById(`${pulse_label.toLowerCase()}-offset-${motor.toLowerCase()}`).value);
    let motor_ratio = parseFloat(document.getElementById(`${pulse_label.toLowerCase()}-ratio-${motor.toLowerCase()}`).value);

    const motor_axis_no = getMotorAxisNo(motor);
    const target = pulse + (offset/motor_ratio);

    document.getElementById(`${pulse_label.toLowerCase()}-target-${motor.toLowerCase()}`).value = target.toFixed(0);
}

function setTargetDistance(motor, pulse_label, result_label) {
    const offset = parseFloat(document.getElementById(`${pulse_label.toLowerCase()}-offset-${motor.toLowerCase()}`).value);
    let motor_ratio = parseFloat(document.getElementById(`${pulse_label.toLowerCase()}-ratio-${motor.toLowerCase()}`).value);

    const motor_axis_no = getMotorAxisNo(motor);
    const target = (offset/motor_ratio);

    document.getElementById(`${pulse_label.toLowerCase()}-target-${motor.toLowerCase()}`).value = target.toFixed(0);
}



function getMotorInfo() {
    const motors = ["X", "Y", "Z", "G"];
    for (let i = 0; i <= 3; i++) {
        const motor = motors[i];
        const motor_axis_no = getMotorAxisNo(motor);
        const data = {
            motor_axis_no: motor_axis_no
        };

        fetch(`${BASE_URL}/motor/info`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(response => response.json())
        .then(data => {
            console.log(`Motor ${motor} Get Response:`, data);

            if(data["data"]["is_motor_power_on"] == 1){
                document.getElementById(`power-btn-${motor.toLowerCase()}`).innerText = "Disable";
            }
            else{
                document.getElementById(`power-btn-${motor.toLowerCase()}`).innerText = "Enable";
            }
            
        })
        .catch((error) => {
            console.error('Error:', error);
        });
    }
}


// Function to call the external API for 'Get' action
function loadMotorData(motor) {
    const motor_axis_no = getMotorAxisNo(motor);
    const data = {
        motor_axis_no: motor_axis_no
    };

    fetch(`/load-parameters`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Get Response:`, data);
        // document.getElementById(`pulse-${motor.toLowerCase()}`).value = data["data"]["position"];
        assign_values(motor.toLowerCase(), data["data"]);
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

function assign_values(motor, data){
    let resolution = document.getElementById(`resolution-${motor.toLowerCase()}`);
    let stealth = document.getElementById(`stealth-${motor.toLowerCase()}`);
    let home_direction = document.getElementById(`home-direction-${motor.toLowerCase()}`);
    let run_current = document.getElementById(`run-current-${motor.toLowerCase()}`);
    let hold_current = document.getElementById(`hold-current-${motor.toLowerCase()}`);
    let torque_mode = document.getElementById(`torque-mode-${motor.toLowerCase()}`);
    let encoder_slip = document.getElementById(`encoder-slip-${motor.toLowerCase()}`);

    resolution.value = data["encoder_ratio"];
    stealth.value = data["stealth_mode"];
    home_direction.value = data["home_direction"];
    run_current.value = data["current_run"];
    hold_current.value = data["current_hold"];
    torque_mode.value = data["torque_watch"];
    encoder_slip.value = data["encoder_slip"];
}

// Function to call the external API for 'Get' action
function getMotorData(motor, label) {
    const motor_axis_no = getMotorAxisNo(motor);
    const data = {
        motor_axis_no: motor_axis_no,
        position_type: "encoder"
    };

    fetch(`${BASE_URL}/motor/position`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Get Response:`, data);
        document.getElementById(`${label.toLowerCase()}-${motor.toLowerCase()}`).value = data["data"]["position"];
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

// Function to call the external API for 'Set' action
function setMotorData(motor, label){
    execReset(motor, "", label);
    execStealth(motor, label);
    setResolution(motor, label);
    setHomeDir(motor, label);
    execSetCurrent(motor, label)
    setInitialTorque(motor, label);
    setInitialEncoderTolerance(motor, "", label);
    execActive(motor, label);
}

// home motor
function homeMotor(motor, button_label, result_label) {
    const motor_axis_no = getMotorAxisNo(motor);
    const data = {
        motor_axis_no: motor_axis_no
    };

    fetch(`${BASE_URL}/motor/home`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Get Response:`, data);
        const el = document.getElementById(`${result_label.toLowerCase()}-${motor.toLowerCase()}`);
        if (el) {
            if (data["status"] == 1){
                el.textContent = "Pass";       // update the text
                el.style.color = "green";      // change text color to green
            }
            else{
                el.textContent = "Error";       // update the text
                el.style.color = "red";      // change text color to green
            }
            
        }
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

// home motor
function originMotor(motor, button_label, result_label) {
    const motor_axis_no = getMotorAxisNo(motor);
    const speed = getMotorSpeed(motor);
    const acceleration = getMotorAcceleration(motor);

    const data = {
        motor_axis_no: motor_axis_no,
        method: 1,
        pulse: 0,
        speed: speed,
        acceleration: acceleration
    };

    fetch(`${BASE_URL}/motor/move`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Get Response:`, data);
        const el = document.getElementById(`${result_label.toLowerCase()}-${motor.toLowerCase()}`);
        el.textContent = "Pass";       // update the text
        el.style.color = "green";      // change text color to green
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

function toggleEncoder(motor, button_label, result_label){
    let motor_axis_no = getMotorAxisNo(motor);
    let power_button = document.getElementById(`${button_label.toLowerCase()}-${motor.toLowerCase()}`);
    let currentText = power_button.innerText;

    let encoder_mode = 0;
    let new_text = "";
    if(currentText == "Disable"){
        encoder_mode = 0;
        new_text = "Enable";
    }
    else{
        encoder_mode = 1;
        new_text = "Disable";
    }

    const data = {
        motor_axis_no: motor_axis_no,
        mode: encoder_mode
    };

    fetch(`${BASE_URL}/motor/encoder/control`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Get Response:`, data);
        // Update text
        power_button.innerText = new_text;
        const el = document.getElementById(`${result_label.toLowerCase()}-${motor.toLowerCase()}`);
        el.textContent = "Pass";       // update the text
        el.style.color = "green";      // change text color to green
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

function toggleActive(motor, button_label, result_label){
    let motor_axis_no = getMotorAxisNo(motor);
    let power_button = document.getElementById(`${button_label.toLowerCase()}-${motor.toLowerCase()}`);
    let currentText = power_button.innerText;

    let power_mode = 0;
    let new_text = "";
    if(currentText == "Disable"){
        power_mode = 0;
        new_text = "Enable";
    }
    else{
        power_mode = 1;
        new_text = "Disable";
    }

    const data = {
        motor_axis_no: motor_axis_no,
        power_option: power_mode
    };

    fetch(`${BASE_URL}/motor/power`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        power_button.innerText = new_text;
        const el = document.getElementById(`${result_label.toLowerCase()}-${motor.toLowerCase()}`);
        el.textContent = "Pass";       // update the text
        el.style.color = "green";      // change text color to green
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}


function execActive(motor, label){
    let motor_axis_no = getMotorAxisNo(motor);
    let power_mode = 1;

    const data = {
        motor_axis_no: motor_axis_no,
        power_option: power_mode
    };

    fetch(`${BASE_URL}/motor/power`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        const el = document.getElementById(`${label.toLowerCase()}-${motor.toLowerCase()}`);
        el.textContent = "Pass";       // update the text
        el.style.color = "green";      // change text color to green
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}



function controlTorque(motor, button_label, result_label){
    var torque_button = document.getElementById(`${button_label.toLowerCase()}-torque-btn-${motor.toLowerCase()}`);
    var currentText = torque_button.innerText;

    if(currentText == "Disable"){
        torque_mode = 0;
        new_text = "Enable";
        setTorque(motor, torque_mode, new_text, button_label, result_label);
    }
    else{
        torque_mode = 1;
        new_text = "Disable";
        setTorque(motor, torque_mode, new_text, button_label, result_label);
        setEncoderTolerance(motor, button_label, result_label);
    }
}

function execSetCurrent(motor, label){
    // set run current
    let motor_axis_no = getMotorAxisNo(motor);
    const run_current = document.getElementById(`run-current-${motor.toLowerCase()}`).value;
    const data = {
        motor_axis_no: motor_axis_no,
        current_limit: run_current,
        current_type: "run"
    };
    _set_current(motor, data, label);

    // set hold current
    const hold_current = document.getElementById(`hold-current-${motor.toLowerCase()}`).value;
    const hold_data = {
        motor_axis_no: motor_axis_no,
        current_limit: hold_current,
        current_type: "hold"
    };
    _set_current(motor, hold_data, label);
}

function execStealth(motor, label){
    let motor_axis_no = getMotorAxisNo(motor);
    const stealth_mode = document.getElementById(`stealth-${motor.toLowerCase()}`).value;
    
    const data = {
        motor_axis_no: motor_axis_no,
        mode: stealth_mode
    };

    fetch(`${BASE_URL}/motor/stealth-mode/control`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Exec Response:`, data);
        const el = document.getElementById(`${label.toLowerCase()}-${motor.toLowerCase()}`);
        el.textContent = "Pass";       // update the text
        el.style.color = "green";      // change text color to green
    })
    .catch((error) => {
        console.error('Error:', error);
    });


}

function execGetCurrent(motor){
    // set run current
    let motor_axis_no = getMotorAxisNo(motor);
    const run_current = document.getElementById(`run-current-${motor.toLowerCase()}`).value;
    const data = {
        motor_axis_no: motor_axis_no,
        current_limit: run_current,
        current_type: "run"
    };
    _get_current(motor, data, "run");

    // set hold current
    const hold_current = document.getElementById(`hold-current-${motor.toLowerCase()}`).value;
    const hold_data = {
        motor_axis_no: motor_axis_no,
        current_limit: hold_current,
        current_type: "hold"
    };
    _get_current(motor, hold_data, "hold");
}

function _set_current(motor, data, label){
    fetch(`${BASE_URL}/motor/current`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Exec Response:`, data);
        const el = document.getElementById(`${label.toLowerCase()}-${motor.toLowerCase()}`);
        el.textContent = "Pass";       // update the text
        el.style.color = "green";      // change text color to green
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

function _get_current(motor, data, current_type){
    if (current_type == "run"){
        var text_box_id = "run";
    }
    else{
        var text_box_id = "hold";
    }
    fetch(`${BASE_URL}/motor/current`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Exec Response:`, data);
        document.getElementById(`${text_box_id}-${motor.toLowerCase()}`).value = data["data"]["current_value"];
        const el = document.getElementById(`result-setting-${motor.toLowerCase()}`);
        el.textContent = "Pass";       // update the text
        el.style.color = "green";      // change text color to green
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

function setResolution(motor, label){
    let motor_axis_no = getMotorAxisNo(motor);
    const micro_step = document.getElementById(`resolution-${motor.toLowerCase()}`).value;
    
    const data = {
        motor_axis_no: motor_axis_no,
        micro_step: micro_step
    };

    fetch(`${BASE_URL}/motor/micro-step`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Exec Response:`, data);
        const el = document.getElementById(`${label.toLowerCase()}-${motor.toLowerCase()}`);
        el.textContent = "Pass";       // update the text
        el.style.color = "green";      // change text color to green
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

function setHomeDir(motor, label){
    let motor_axis_no = getMotorAxisNo(motor);
    let home_dir = document.getElementById(`home-direction-${motor.toLowerCase()}`).value;
    
    const data = {
        motor_axis_no: motor_axis_no,
        home_direction: home_dir
    };

    fetch(`${BASE_URL}/motor/home-direction/save`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Exec Response:`, data);
        const el = document.getElementById(`${label.toLowerCase()}-${motor.toLowerCase()}`);
        el.textContent = "Pass";       // update the text
        el.style.color = "green";      // change text color to green
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

function setInitialTorque(motor, label){
    let motor_axis_no = getMotorAxisNo(motor);
    let torque = document.getElementById(`torque-mode-${motor.toLowerCase()}`).value;
    
    const data = {
        motor_axis_no: motor_axis_no,
        torque_mode: torque,
        start_torque_location: 0
    };

    fetch(`${BASE_URL}/motor/torque`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        const el = document.getElementById(`${label.toLowerCase()}-${motor.toLowerCase()}`);
        el.textContent = "Pass";       // update the text
        el.style.color = "green";      // change text color to green
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

function setTorque(motor, torque_mode, new_text, button_label, result_label){
    var motor_axis_no = getMotorAxisNo(motor);
    var button = document.getElementById(`${button_label.toLowerCase()}-torque-btn-${motor.toLowerCase()}`);
    var torque_location = parseFloat(document.getElementById(`${button_label.toLowerCase()}-percent-${motor.toLowerCase()}`).value);
    
    if (isNaN(torque_location)) {
        torque_location = 0;
    }

    const data = {
        motor_axis_no: motor_axis_no,
        torque_mode: torque_mode,
        start_torque_location: torque_location
    };

    fetch(`${BASE_URL}/motor/torque`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        button.innerText = new_text;
        const el = document.getElementById(`${result_label.toLowerCase()}-${motor.toLowerCase()}`);
        el.textContent = "Pass";       // update the text
        el.style.color = "green";      // change text color to green
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

function setInitialEncoderTolerance(motor, temp, result_label){
    var motor_axis_no = getMotorAxisNo(motor);
    var encoder_tolerance = parseInt(document.getElementById(`encoder-slip-${motor.toLowerCase()}`).value);
    const data = {
        motor_axis_no: motor_axis_no,
        encoder_tolerance: encoder_tolerance
    };

    fetch(`${BASE_URL}/motor/encoder`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Get Response:`, data);
        const el = document.getElementById(`${result_label.toLowerCase()}-${motor.toLowerCase()}`);
        el.textContent = "Pass";       // update the text
        el.style.color = "green";      // change text color to green
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

function setEncoderTolerance(motor, button_label, result_label){
    var motor_axis_no = getMotorAxisNo(motor);
    var encoder_tolerance = parseInt(document.getElementById(`${button_label.toLowerCase()}-torque-${motor.toLowerCase()}`).value);
    const data = {
        motor_axis_no: motor_axis_no,
        encoder_tolerance: encoder_tolerance
    };

    fetch(`${BASE_URL}/motor/torque-encoder`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Get Response:`, data);
        const el = document.getElementById(`${result_label.toLowerCase()}-${motor.toLowerCase()}`);
        el.textContent = "Pass";       // update the text
        el.style.color = "green";      // change text color to green
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

// error reset
function execReset(motor, button_label, result_label) {
    const motor_axis_no = getMotorAxisNo(motor);
    const data = {
        motor_axis_no: motor_axis_no
    };

    fetch(`${BASE_URL}/motor/reset-error`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Get Response:`, data);
        const el = document.getElementById(`${result_label.toLowerCase()}-${motor.toLowerCase()}`);

        if(data["status"] == 1){
            el.textContent = "Pass";       // update the text
            el.style.color = "green";      // change text color to green
        }
        else{
            el.textContent = "Fail";       // update the text
            el.style.color = "red";      // change text color to green
        }
        
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

function stop_motors(){
    fetch(`${BASE_URL}/motor/stop`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Get Response:`, data);
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

function emergency_reset() {
    fetch(`${BASE_URL}/mmu/reset`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Get Response:`, data);
    })
    .catch((error) => {
        console.error('Error:', error);
    });
}

// Function to call the external API for 'Exec' action
function execMotor(motor) {
    const pulse = document.getElementById(`abs-pulse-${motor.toLowerCase()}`).value;
    const offset = document.getElementById(`abs-offset-${motor.toLowerCase()}`).value;
    const target = document.getElementById(`abs-target-${motor.toLowerCase()}`).value;

    const speed = document.getElementById(`abs-speed-${motor.toLowerCase()}`).value; // getMotorSpeed(motor);
    const acceleration = document.getElementById(`abs-acc-${motor.toLowerCase()}`).value; // getMotorAcceleration(motor);

    const motor_axis_no = getMotorAxisNo(motor);
    const data = {
        motor_axis_no: motor_axis_no,
        method: 1, // absolute movement
        pulse: target,
        speed: speed,
        acceleration: acceleration
    };

    fetch(`${BASE_URL}/motor/move`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Exec Response:`, data);
        const el = document.getElementById(`abs-result-${motor.toLowerCase()}`);
        if (el) {
            if (data["status"] == 1 && data["data"]["error_code"] == 0){
                el.textContent = "Pass";       // update the text
                el.style.color = "green";      // change text color to green
            }
            else{
                el.textContent = "Error";       // update the text
                el.style.color = "red";      // change text color to green
            }
        }
    })
    .catch((error) => {
        console.error('Error:', error);
        result_label.textContent = "Error";
    });
}

function forceMotor(motor, label) {
    const pulse = document.getElementById(`abs-pulse-${motor.toLowerCase()}`).value;
    const offset = document.getElementById(`abs-offset-${motor.toLowerCase()}`).value;
    const target = document.getElementById(`abs-target-${motor.toLowerCase()}`).value;
    const speed = document.getElementById(`abs-speed-${motor.toLowerCase()}`).value; // getMotorSpeed(motor);
    const acceleration = document.getElementById(`abs-acc-${motor.toLowerCase()}`).value; // getMotorAcceleration(motor);
    const motor_axis_no = getMotorAxisNo(motor);

    const data = {
        motor_axis_no: motor_axis_no,
        method: 1, // absolute movement
        pulse: target,
        speed: speed,
        acceleration: acceleration
    };

    fetch(`${BASE_URL}/motor/force-move`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Exec Response:`, data);
        const el = document.getElementById(`${label.toLowerCase()}-${motor.toLowerCase()}`);
        if (el) {
            if (data["status"] == 1 && data["data"]["error_code"] == 0){
                el.textContent = "Pass";       // update the text
                el.style.color = "green";      // change text color to green
            }
            else{
                el.textContent = "Fail";       // update the text
                el.style.color = "red";      // change text color to green
            }
        }
    })
    .catch((error) => {
        console.error('Error:', error);
        result_label.textContent = "Error";
    });
}

function relativeForceMotor(motor, direction) {
    const distance = parseInt(document.getElementById(`rel-target-${motor.toLowerCase()}`).value);
    const speed = parseInt(document.getElementById(`rel-speed-${motor.toLowerCase()}`).value); // getMotorSpeed(motor);
    const acceleration = parseInt(document.getElementById(`rel-acc-${motor.toLowerCase()}`).value); // getMotorAcceleration(motor);
    const motor_axis_no = getMotorAxisNo(motor);

    if(direction == "cw"){
        var data = {
            motor_axis_no: motor_axis_no,
            method: 2, // relative movement - CW
            pulse: distance,
            speed: speed,
            acceleration: acceleration
        };
    }
    else{
        var data = {
            motor_axis_no: motor_axis_no,
            method: 3, // relative movement - CCW
            pulse: distance,
            speed: speed,
            acceleration: acceleration
        };
    }

    fetch(`${BASE_URL}/motor/force-move`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        console.log(`Motor ${motor} Exec Response:`, data);
        const el = document.getElementById(`rel-result-${motor.toLowerCase()}`);
        if (el) {
            if (data["status"] == 1 && data["data"]["error_code"] == 0){
                el.textContent = "Pass";       // update the text
                el.style.color = "green";      // change text color to green
            }
            else{
                el.textContent = "Error";       // update the text
                el.style.color = "red";      // change text color to green
            }
        }
    })
    .catch((error) => {
        console.error('Error:', error);
        result_label.textContent = "Error";
    });
}

// Function to map motor to axis number
function getMotorAxisNo(motor) {
    switch (motor) {
        case "X": return 2;
        case "Y": return 1;
        case "Z": return 3;
        case "G": return 4;
        default: return 0;
    }
}

function getMotorRatio(motor) {
    switch (motor) {
        case "X": return 2.51;
        case "Y": return 2.61;
        case "Z": return 7.1;
        case "G": return 1.2;
        default: return 1;
    }
}

function getMotorAcceleration(motor) {
    switch (motor) {
        case "X": return 200;
        case "Y": return 200;
        case "Z": return 200;
        case "G": return 500;
        default: return 1;
    }
}

function getMotorSpeed(motor) {
    switch (motor) {
        case "X": return 2000;
        case "Y": return 2000;
        case "Z": return 500;
        case "G": return 2000;
        default: return 1;
    }
}

// Function to snap an image
async function snapImage(section) {
    try {
        const response = await fetch(`${SNAPSHOT_URL}`);
        
        // section === "absolute" ? "live_view_toggle_absolute" : "live_view_toggle_relative";
        var image_in_model = section == "absolute" ? "thumbnail-image" : "thumbnail-image-2";
        var snapshot_image = section == "absolute" ? "snapshot-image" : "snapshot-image-2";
        var label = section == "absolute" ? "model-label-absolute" : "model-label-relative";

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        const imgElement = document.getElementById(snapshot_image);
        imgElement.src = SNAPSHOT_URL; // Set the image source to the fetched image
        imgElement.style.display = 'block'; // Make the image visible

        const labelElement = document.getElementById(label);
        labelElement.style.display = 'block'; // Make the label visible

        const imgElement2 = document.getElementById(image_in_model);
        imgElement2.src = SNAPSHOT_URL; // Set the image source to the fetched image
        imgElement2.style.display = 'block'; // Make the image visible

    } catch (error) {
        console.error('Error fetching image:', error);
        alert('Failed to fetch image. Please try again.');
    }
}

window.onload = function() {
    document.getElementById("h3-title-span").innerText = `Version ${VERSION}`;
};

let scale = 1;
function openModal() {
    const snapshotImage = document.getElementById("snapshot-image");
    snapshotImage.src = SNAPSHOT_URL;
    document.getElementById("imageModal").style.display = "block";
}

function openModal2() {
    const snapshotImage = document.getElementById("snapshot-image-2");
    snapshotImage.src = SNAPSHOT_URL;
    document.getElementById("imageModal2").style.display = "block";
}

function closeModal() {
    document.getElementById("imageModal").style.display = "none";
    resetImageScale(); // Reset scale when closing modal
}

function closeModal2() {
    document.getElementById("imageModal2").style.display = "none";
    resetImageScale(); // Reset scale when closing modal
}

function zoomImage(event) {
    event.preventDefault(); // Prevent the default scroll behavior
    
    if (event.deltaY < 0) {
        scale += 0.1; // Zoom in
    } else {
        scale = Math.max(scale - 0.1, 1); // Zoom out but not below 1
    }
    
    updateImageScale();
}

function updateImageScale() {
    const imgElement = document.getElementById('snapshot-image');
    imgElement.style.transform = `scale(${scale})`;
    
}

function resetImageScale() {
    scale = 1; // Reset scale to original size
    updateImageScale(); // Apply reset
}

function showCoordinates(event) {
    const imgElement = document.getElementById('snapshot-image');
    const rect = imgElement.getBoundingClientRect();
    
    // Calculate the mouse position relative to the image
    const x = Math.round(event.clientX - rect.left);
    const y = Math.round(event.clientY - rect.top);

    // Display the coordinates
    const coordinatesDisplay = document.getElementById('coordinates');
    coordinatesDisplay.style.display = 'block';
    coordinatesDisplay.style.left = `${event.clientX - rect.left + 10}px`;
    coordinatesDisplay.style.top = `${event.clientY - rect.top + 10}px`;
    coordinatesDisplay.textContent = `X: ${x}, Y: ${y}`;
}

function hideCoordinates() {
    const coordinatesDisplay = document.getElementById('coordinates');
    coordinatesDisplay.style.display = 'none';
}

// Close the modal when clicking anywhere outside of it
window.onclick = function(event) {
    const modal = document.getElementById("imageModal");
    if (event.target === modal) {
        closeModal();
    }

    const modal2 = document.getElementById("imageModal2");
    if (event.target === modal2) {
        closeModal2();
    }
}

// get radio buttons and image
const simplexRadio = document.getElementById("simplexRadio");
const duplexRadio = document.getElementById("duplexRadio");
const simplexRadioPort = document.getElementById("simplexRadioPort");
const duplexRadioPort = document.getElementById("duplexRadioPort");
const portMapImage = document.getElementById("portMapImage");

// event listeners
simplexRadio.addEventListener("change", () => {
    if (simplexRadio.checked) {
    portMapImage.src = "/static/img/simplex_smu_view.png"; // change to simplex image
    }
});

duplexRadio.addEventListener("change", () => {
    if (duplexRadio.checked) {
    portMapImage.src = "/static/img/duplex_smu_view.png"; // change to duplex image
    }
});

simplexRadioPort.addEventListener("change", () => {
    if (simplexRadioPort.checked) {
    portMapImage.src = "/static/img/simplex_port_view.png"; // change to simplex image
    }
});

duplexRadioPort.addEventListener("change", () => {
    if (duplexRadioPort.checked) {
    portMapImage.src = "/static/img/duplex_port_view.png"; // change to duplex image
    }
});


// Camera Control
function startCamera(){
    var data = {
        cam_no: 1,
        action: 1,
    }
    fetch(`${CAMERA_CONTROL_URL}/backend-host/camera/camera_control`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        const el = document.getElementById(`camera-control-result`);
        if (el) {
            if (data["status"] == 1){
                var status = "Success";
                el.textContent = "Pass";       // update the text
                el.style.color = "green";      // change text color to green
            }
            else{
                var status = "Fail";
                el.textContent = "Fail";       // update the text
                el.style.color = "red";      // change text color to green
            }
        }

        const imgElement = document.getElementById('camera-control-image');
        imgElement.src = SENDSTREAM_URL;

        var message = "Result: " + status + "\nMessage: " + data["msg"] + "\n* Please check EMS application. *";
        alert(message);
    })
    .catch((error) => {
        result_label.textContent = "Error";
    });

}

function stopCamera(){
    var data = {
        cam_no: 1,
        action: 0,
    }
    fetch(`${CAMERA_CONTROL_URL}/backend-host/camera/camera_control`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
        const el = document.getElementById(`camera-control-result`);
        if (el) {
            if (data["status"] == 1){
                var status = "Success";
                el.textContent = "Pass";       // update the text
                el.style.color = "green";      // change text color to green
            }
            else{
                var status = "Fail";
                el.textContent = "Fail";       // update the text
                el.style.color = "red";      // change text color to green
            }
        }

        const imgElement = document.getElementById('camera-control-image');
        imgElement.src = SENDSTREAM_URL;

        var message = "Result: " + status + "\nMessage: " + data["msg"] + "\n* Please check EMS application. *";
        alert(message);
    })
    .catch((error) => {
        result_label.textContent = "Error";
    });
}


function changeModel(to_model){
    if(to_model == "simplex"){
        var url = CHANGE_MODEL_URL_SIMPLEX;
    }
    else{
        var url = CHANGE_MODEL_URL_DUPLEX;
    }

    fetch(`${url}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        const el = document.getElementById(`model-control-result`);
        if (el) {
            if (data["status"] == 1){
                var status = "Success";
                el.textContent = "Pass";       // update the text
                el.style.color = "green";      // change text color to green
            }
            else{
                var status = "Fail";
                el.textContent = "Fail";       // update the text
                el.style.color = "red";      // change text color to green
            }
        }

        var message = "Result: " + status + "\nMessage: " + data["msg"] + "\n* Please check EMS application. *";
        alert(message);

    })
    .catch((error) => {
        result_label.textContent = "Error";
    });
}

function toggleLiveView(section) {
    const config = {
        absolute: { toggleId: "live_view_toggle_absolute", imageId: "liveview-image" },
        relative: { toggleId: "live_view_toggle_relative", imageId: "liveview-image-2" },
        control:  { toggleId: "live_view_toggle_control",  imageId: "camera-control-image" }
    };

    const selected = config[section];
    if (!selected) {
        console.warn("Unknown section:", section);
        return;
    }

    const toggle = document.getElementById(selected.toggleId);
    const img = document.getElementById(selected.imageId);

    

    if (!toggle || !img) {
        console.warn("Missing elements for section:", section);
        return;
    }

    img.src = toggle.checked ? SENDSTREAM_URL : "";
    img.style.display = toggle.checked ? "block" : "none";
}
