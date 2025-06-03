let modeloFuzzy = null;

// Función para calcular el grado de pertenencia de una función triangular
function membresiaTriangular(p, a, b, c) {
    if (p <= a || p >= c) {
        return 0;
    } else if (p >= a && p <= b) {
        return (p - a) / (b - a);
    } else if (p >= b && p <= c) {
        return (c - p) / (c - b);
    }
    return 0;
}

// Fuzzificación: Convierte entradas nítidas a grados de pertenencia difusos
function fuzzificar(valor, funcionesMembresia) {
    const grados = {};
    for (const termino in funcionesMembresia) {
        const params = funcionesMembresia[termino];
        grados[termino] = membresiaTriangular(valor, params[0], params[1], params[2]);
    }
    return grados;
}

// Inferencia: Aplica las reglas difusas para obtener conjuntos difusos de salida activados
function inferir(gradosEntrada, reglas, salidasConfig) {
    const activacionSalidas = {}; // { output_variable: { term: max_degree_activation } }

    // Inicializa la activación para todos los términos de salida a 0
    for (const salidaVar in salidasConfig) {
        activacionSalidas[salidaVar] = {};
        for (const termino in salidasConfig[salidaVar].funciones_membresia) {
            activacionSalidas[salidaVar][termino] = 0;
        }
    }

    for (const regla of reglas) {
        let gradoActivacionAntecedente = 1.0; // Inicializa con la máxima activación posible

        // Calcula el grado de activación para la parte "IF" (antecedente)
        // Usando Math.min para el AND lógico (T-norma)
        for (const inputVar in regla.if) {
            const inputTerm = regla.if[inputVar];
            // Asegúrate de que la variable de entrada exista y tenga el término
            gradoActivacionAntecedente = Math.min(gradoActivacionAntecedente, gradosEntrada[inputVar][inputTerm] || 0);
        }

        // Aplica el peso de la regla (si está definido)
        const ruleWeight = regla.weight !== undefined ? regla.weight : 1.0;
        const finalGradoActivacionRegla = gradoActivacionAntecedente * ruleWeight;

        // Aplica el grado de activación a la parte "THEN" (consecuente)
        // Usando Math.max para el OR lógico (T-conorma) para combinar reglas que activan el mismo término
        for (const outputVar in regla.then) {
            const outputTerm = regla.then[outputVar];
            activacionSalidas[outputVar][outputTerm] = Math.max(activacionSalidas[outputVar][outputTerm] || 0, finalGradoActivacionRegla);
        }
    }
    return activacionSalidas;
}


// Defuzzificación: Convierte los conjuntos difusos activados a valores nítidos
// Usando el método del Centroide (aproximado)
function defuzzificar(activacionSalidaTerminos, funcionesMembresiaSalida, rangoSalida) {
    let numerador = 0;
    let denominador = 0;
    const numPuntos = 100; // Número de puntos para la aproximación del centroide

    // Si no se activó ningún término para esta salida, retorna un valor por defecto (mitad del rango)
    if (Object.keys(activacionSalidaTerminos).every(term => activacionSalidaTerminos[term] === 0)) {
        return (rangoSalida[0] + rangoSalida[1]) / 2;
    }

    for (let i = 0; i <= numPuntos; i++) {
        const x = rangoSalida[0] + (i / numPuntos) * (rangoSalida[1] - rangoSalida[0]);
        let maxMembresiaCombined = 0; // La membresía combinada para este valor x a través de todos los términos activados

        // Combina los conjuntos difusos activados (recortando cada uno por su grado de activación)
        // usando el máximo (operador OR)
        for (const terminoSalida in activacionSalidaTerminos) {
            const gradoActivacion = activacionSalidaTerminos[terminoSalida];
            const params = funcionesMembresiaSalida[terminoSalida];
            const membresiaOriginal = membresiaTriangular(x, params[0], params[1], params[2]);
            maxMembresiaCombined = Math.max(maxMembresiaCombined, Math.min(gradoActivacion, membresiaOriginal)); // Implicación: MIN (Mamdani)
        }
        numerador += x * maxMembresiaCombined;
        denominador += maxMembresiaCombined;
    }

    return denominador === 0 ? (rangoSalida[0] + rangoSalida[1]) / 2 : numerador / denominador;
}

// Función principal para clasificar el riesgo de crédito
async function clasificarRiesgo() {
    if (!modeloFuzzy) {
        await cargarModelo();
    }

    const ingresos = parseFloat(document.getElementById('ingresos').value);
    const historial_pagos = parseFloat(document.getElementById('historial_pagos').value);
    const deuda_relativa = parseFloat(document.getElementById('deuda_relativa').value);

    if (isNaN(ingresos) || isNaN(historial_pagos) || isNaN(deuda_relativa)) {
        alert("Por favor, introduce valores válidos para todos los campos.");
        return;
    }

    // 1. Fuzzificación
    const gradosIngresos = fuzzificar(ingresos, modeloFuzzy.entradas.ingresos.funciones_membresia);
    const gradosHistorialPagos = fuzzificar(historial_pagos, modeloFuzzy.entradas.historial_pagos.funciones_membresia);
    const gradosDeudaRelativa = fuzzificar(deuda_relativa, modeloFuzzy.entradas.deuda_relativa.funciones_membresia);

    const gradosEntrada = {
        ingresos: gradosIngresos,
        historial_pagos: gradosHistorialPagos,
        deuda_relativa: gradosDeudaRelativa
    };

    // 2. Inferencia
    const activacionSalidas = inferir(gradosEntrada, modeloFuzzy.rules, modeloFuzzy.salidas);

    // 3. Defuzzificación para cada salida (riesgo_bajo, riesgo_medio, riesgo_alto)
    const resultadosClasificacion = {};
    for (const salidaVar in modeloFuzzy.salidas) {
        const valorNítido = defuzzificar(
            activacionSalidas[salidaVar],
            modeloFuzzy.salidas[salidaVar].funciones_membresia,
            modeloFuzzy.salidas[salidaVar].rango
        );
        resultadosClasificacion[salidaVar] = valorNítido;
    }

    // Determina el riesgo más probable
    let riesgoMasProbable = "Indeterminado";
    let maxProbabilidad = -1; // Usamos -1 para asegurarnos de que cualquier probabilidad sea mayor

    // Comparamos las probabilidades de cada tipo de riesgo para determinar el más probable
    if (resultadosClasificacion.riesgo_bajo > maxProbabilidad) {
        maxProbabilidad = resultadosClasificacion.riesgo_bajo;
        riesgoMasProbable = "BAJO";
    }
    // Usamos ">" para priorizar el riesgo más alto si las probabilidades son iguales o cercanas.
    if (resultadosClasificacion.riesgo_medio > maxProbabilidad) {
        maxProbabilidad = resultadosClasificacion.riesgo_medio;
        riesgoMasProbable = "MEDIO";
    }
    if (resultadosClasificacion.riesgo_alto > maxProbabilidad) {
        maxProbabilidad = resultadosClasificacion.riesgo_alto;
        riesgoMasProbable = "ALTO";
    }

    // Genera la recomendación basada en el nivel de riesgo
    let recomendacionTexto = "";
    let recomendacionClass = "";

    switch (riesgoMasProbable) {
        case "BAJO":
            recomendacionTexto = "¡**Excelente**! Su perfil de crédito sugiere un **riesgo bajo**. Es un buen momento para explorar opciones de crédito con condiciones favorables. Mantenga un historial de pagos impecable y una deuda controlada para preservar este estado.";
            recomendacionClass = "low-risk";
            break;
        case "MEDIO":
            recomendacionTexto = "Su riesgo de crédito es **medio**. Es probable que califique para algunos productos, pero hay margen para mejorar. Considere **reducir su deuda** si es alta y **asegurarse de pagar a tiempo** todas sus obligaciones para fortalecer su historial.";
            recomendacionClass = "medium-risk";
            break;
        case "ALTO":
            recomendacionTexto = "¡**Atención**! Su riesgo de crédito es **alto**. Obtener nuevos créditos será un desafío. Le recomendamos enfáticamente **enfocarse en reducir agresivamente su deuda**, **mejorar su historial de pagos** (evitando cualquier retraso) y, si es posible, buscar formas de **aumentar sus ingresos** para mejorar su situación financiera. Podría ser útil buscar asesoría financiera.";
            recomendacionClass = "high-risk";
            break;
        default:
            recomendacionTexto = "No se pudo determinar una recomendación específica. Por favor, verifique los datos ingresados.";
            recomendacionClass = "";
    }

    // Formatea y muestra los resultados
    let resultadosHTML = `
        El riesgo de crédito más probable es: <span style="font-weight: bold; color: ${riesgoMasProbable === 'ALTO' ? '#d9534f' : riesgoMasProbable === 'MEDIO' ? '#f0ad4e' : '#5cb85c'};">${riesgoMasProbable}</span>
        <br><br>
        <div style="text-align: left; padding-left: 20px;">
            Probabilidad de Riesgo Bajo: ${resultadosClasificacion.riesgo_bajo.toFixed(2)}%<br>
            Probabilidad de Riesgo Medio: ${resultadosClasificacion.riesgo_medio.toFixed(2)}%<br>
            Probabilidad de Riesgo Alto: ${resultadosClasificacion.riesgo_alto.toFixed(2)}%
        </div>
    `;

    document.getElementById('resultado').innerHTML = resultadosHTML;
    const recomendacionDiv = document.getElementById('recomendacion');
    recomendacionDiv.innerHTML = `<strong>Recomendación:</strong> ${recomendacionTexto}`;
    recomendacionDiv.className = recomendacionClass; // Aplica la clase para el estilo visual
}

// Carga el archivo model.json
async function cargarModelo() {
    try {
        const response = await fetch('model.json');
        if (!response.ok) {
            throw new Error(`Error HTTP! estado: ${response.status}`);
        }
        modeloFuzzy = await response.json();
        console.log('Modelo Fuzzy de Riesgo de Crédito cargado correctamente:', modeloFuzzy);
    } catch (error) {
        console.error('Error al cargar el modelo Fuzzy:', error);
        document.getElementById('resultado').innerHTML = `<span style="color: red;">Error al cargar el modelo. Por favor, verifica que 'model.json' exista y sea válido.</span>`;
    }
}

// Carga el modelo cuando la página se inicia
window.onload = cargarModelo;