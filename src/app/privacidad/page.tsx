import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * /privacidad — política de tratamiento de datos personales del SIG.
 *
 * Responde al deber de información y transparencia del art. 14 ter de la
 * Ley 19.628, en el texto que fija la Ley 21.719 (vigente desde el 1 de
 * diciembre de 2026). Cada sección corresponde a una letra de ese artículo:
 * a) política, fecha y versión · b) responsable · c) medio de contacto ·
 * d) categorías, universo, destinatarios, finalidades y base de licitud ·
 * e) seguridad · f) derechos del titular.
 *
 * Página estática: no consulta ninguna base. Si cambia lo que expone la API,
 * la analítica o un proveedor, actualizar esta página y su FECHA.
 */

export const metadata: Metadata = {
  title: 'Política de privacidad — SIG de suelo | gabrielpantoja.cl',
  description:
    'Qué datos trata el SIG de suelo, con qué fin y base legal, a quién se comunican, cómo se protegen y cómo ejercer tus derechos (Ley 19.628 modificada por la Ley 21.719).',
};

const FECHA = '13 de noviembre de 2026';
const CORREO = 'peritajes@gabrielpantoja.cl';

const link =
  'underline underline-offset-2 decoration-black/30 hover:decoration-current dark:decoration-white/30';

export default function PrivacidadPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 md:px-6 md:py-10">
      <header className="flex items-center justify-between gap-4 border-b border-black/10 pb-4 dark:border-white/10">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.18em] opacity-60 md:text-xs">
            SIG de suelo · gabrielpantoja.cl
          </p>
          <h1 className="mt-1 text-xl font-semibold md:text-2xl">Política de privacidad</h1>
        </div>
        <Link
          href="/"
          className="shrink-0 rounded-full border border-black/15 px-3 py-1.5 text-xs transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(153_28%_35%)] dark:border-white/20 dark:hover:bg-white/10"
        >
          ← Volver al mapa
        </Link>
      </header>

      <p className="mt-4 text-xs opacity-60">
        Vigente desde el {FECHA}
      </p>

      <section className="mt-6 rounded-lg border border-l-[3px] border-black/10 border-l-[hsl(153_28%_35%)] p-4 text-sm dark:border-white/10 dark:border-l-[hsl(153_28%_35%)]">
        <p className="opacity-85">
          Este sitio publica compraventas de inmuebles inscritas en los Conservadores de Bienes
          Raíces para estudiar el valor y el contexto del suelo en Chile, sobre todo cómo esos datos
          pueden contribuir a la conservación de la naturaleza y a su planificación sistemática.
          Nunca muestra nombres ni
          RUT de compradores o vendedores. Aun así, una compraventa con su ubicación, ROL y precio
          puede llegar a vincularse con su propietario si se cruza con otras fuentes, y por eso la
          tratamos como dato personal, con las reglas de la ley.
        </p>
        <p className="mt-3 opacity-85">
          Para consultas o para ejercer tus derechos escribe a{' '}
          <a href={`mailto:${CORREO}`} className={link}>
            {CORREO}
          </a>
          .
        </p>
      </section>

      <Seccion titulo="1. Responsable de los datos">
        <p>
          El responsable del tratamiento es <strong>Gabriel Pantoja Rivera</strong>, persona natural,
          autor y mantenedor del SIG de suelo (sig.gabrielpantoja.cl). No hay representante legal ni
          encargado de prevención designado, porque el sitio es un proyecto personal de
          investigación sin fines comerciales.
        </p>
        <p>
          Medio de contacto para solicitudes y comunicaciones:{' '}
          <a href={`mailto:${CORREO}`} className={link}>
            {CORREO}
          </a>
          .
        </p>
      </Seccion>

      <Seccion titulo="2. Qué datos tratamos">
        <h3 className="font-medium">a) Transacciones inscritas en los Conservadores</h3>
        <p>
          Por cada compraventa se publican: ubicación (latitud y longitud), comuna y Conservador,
          nombre o dirección del predio tal como figura en la inscripción, ROL de avalúo, superficie,
          destino del inmueble, monto (en pesos o UF), año, y fechas de escritura e inscripción
          cuando existen.
        </p>
        <p>
          <strong>Universo de personas:</strong> quienes compraron o vendieron un inmueble cuya
          inscripción forma parte de la recopilación. <strong>No se publican</strong> nombres,
          RUT ni observaciones de las partes; esos campos ni siquiera se consultan desde el sitio.
        </p>

        <h3 className="mt-4 font-medium">b) Uso del sitio (analítica interna)</h3>
        <p>
          Registramos eventos de uso para saber qué herramientas sirven: página vista, tiempo de uso
          activo, herramientas usadas (solo su nombre, nunca lo que escribes ni los valores de los
          filtros), sitio de origen, parámetros de campaña (utm), tipo de dispositivo, navegador,
          sistema operativo, ancho de pantalla, y país, región y ciudad aproximados que entrega el
          proveedor de alojamiento.
        </p>
        <p>
          No guardamos tu dirección IP. Para contar visitantes únicos se calcula un identificador
          cifrado (HMAC) a partir de la IP y el navegador, que cambia cada día: no permite
          seguirte de un día a otro. No usamos cookies de seguimiento ni almacenamiento local para
          esto. También registramos las descargas de datos por la API (ruta, nombres de los filtros
          y tipo de cliente) para saber cómo se reutiliza el conjunto.
        </p>

        <h3 className="mt-4 font-medium">c) Lo que tú ingresas</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Búsqueda de direcciones:</strong> el texto se envía a OpenStreetMap
            (Nominatim) para encontrar el lugar. No lo guardamos.
          </li>
          <li>
            <strong>Tu ubicación (GPS):</strong> solo si la pides con el botón «Ir a mi
            ubicación». Se usa en tu navegador para centrar el mapa y no se envía a nuestro
            servidor.
          </li>
          <li>
            <strong>Polígonos, vértices y archivos KML:</strong> los KML se leen en tu navegador.
            Cuando pides «Analizar predio», el polígono se envía al servidor para calcularlo y no se
            guarda.
          </li>
        </ul>
      </Seccion>

      <Seccion titulo="3. De dónde vienen los datos">
        <p>
          Las transacciones son una recopilación propia de inscripciones de compraventa de los
          Conservadores de Bienes Raíces, que son registros públicos (fuentes de acceso público
          según el art. 2 letra i de la Ley 19.628). Las demás capas del mapa provienen de servicios
          oficiales y abiertos; cada una indica su fuente y licencia en la leyenda.
        </p>
      </Seccion>

      <Seccion titulo="4. Para qué los usamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Investigar el valor y la dinámica del suelo en Chile y su relación con el territorio
            (suelo, agua, vegetación, relieve, áreas protegidas), en particular cómo los datos
            del mercado de suelo pueden contribuir a la conservación de la naturaleza y a la
            planificación sistemática de la conservación.
          </li>
          <li>
            Ofrecer datos abiertos de mercado de suelo como apoyo a la investigación y al trabajo de
            peritos tasadores.
          </li>
          <li>Con la analítica: mantener, medir y mejorar el sitio.</li>
        </ul>
        <p>
          No usamos los datos para marketing, perfilamiento de personas ni decisiones automatizadas
          sobre nadie, y no los vendemos.
        </p>
      </Seccion>

      <Seccion titulo="5. Base de licitud">
        <p>
          El tratamiento se basa en el <strong>interés legítimo</strong> (art. 13 letra d de la Ley
          19.628), sin consentimiento de los titulares:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Transacciones:</strong> el interés en investigar y transparentar el mercado de
            suelo con información que ya consta en registros públicos. Para no afectar los derechos
            de los titulares se excluyen nombres, RUT y observaciones, no se elaboran perfiles de
            personas y se atienden las solicitudes de oposición y supresión (sección 9).
          </li>
          <li>
            <strong>Analítica:</strong> el interés en mantener y mejorar el servicio, con datos
            seudonimizados que no permiten seguir a una persona entre días.
          </li>
        </ul>
        <p>
          Puedes pedir en cualquier momento que te informemos sobre el tratamiento que te afecta y
          el interés legítimo que lo sustenta.
        </p>
      </Seccion>

      <Seccion titulo="6. A quién se comunican">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Público general:</strong> las transacciones, con los campos de la sección 2 a),
            se muestran en el mapa y pueden descargarse en CSV o GeoJSON. Los datos de analítica y lo
            que tú ingresas no se publican.
          </li>
          <li>
            <strong>Proveedores que procesan datos por cuenta del sitio:</strong> Vercel
            (alojamiento y entrega del sitio), Neon (base de datos), OpenStreetMap Foundation
            (búsqueda de direcciones) y los servicios cartográficos oficiales que responden las
            consultas de capas (reciben la zona del mapa o el ROL consultado, no tu identidad).
          </li>
          <li>
            <strong>Transferencia internacional:</strong> estos proveedores pueden almacenar o
            procesar datos fuera de Chile.
          </li>
        </ul>
      </Seccion>

      <Seccion titulo="7. Cuánto tiempo los conservamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Transacciones:</strong> mientras dure el proyecto de investigación, salvo que
            se ejerza con éxito un derecho de supresión u oposición.
          </li>
          <li>
            <strong>Analítica:</strong> 13 meses; después se borra de forma automática.
          </li>
          <li>
            <strong>Búsquedas, ubicación y polígonos:</strong> no se conservan.
          </li>
        </ul>
      </Seccion>

      <Seccion titulo="8. Cómo protegemos los datos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Todo el sitio funciona solo por HTTPS (con HSTS).</li>
          <li>
            El sitio lee las transacciones con un usuario de base de datos de solo lectura, y cada
            consulta enumera sus columnas: los campos de nombre, RUT y observaciones nunca se leen.
          </li>
          <li>
            La analítica vive en un esquema separado, con un usuario propio que no puede leer las
            transacciones.
          </li>
          <li>
            Límites de uso por dirección IP contra abusos (la IP se usa en memoria y no se guarda).
          </li>
          <li>
            Respaldo diario restaurado y verificado en una base independiente (ver{' '}
            <Link href="/estado" className={link}>
              estado de los datos
            </Link>
            ).
          </li>
          <li>
            El código es abierto y auditable en{' '}
            <a
              href="https://github.com/gabrielpantoja-cl/sig.gabrielpantoja.cl"
              target="_blank"
              rel="noopener noreferrer"
              className={link}
            >
              GitHub
            </a>
            .
          </li>
        </ul>
      </Seccion>

      <Seccion titulo="9. Tus derechos y cómo ejercerlos">
        <p>
          Como titular puedes solicitar <strong>acceso</strong>, <strong>rectificación</strong>,{' '}
          <strong>supresión</strong>, <strong>oposición</strong>, <strong>portabilidad</strong> y{' '}
          <strong>bloqueo temporal</strong> del tratamiento de tus datos, y oponerte a decisiones
          automatizadas que te afecten.
        </p>
        <p>
          Escribe a{' '}
          <a href={`mailto:${CORREO}`} className={link}>
            {CORREO}
          </a>{' '}
          indicando qué derecho ejerces y cómo ubicar el registro: idealmente el ROL, la comuna y el
          año de la compraventa. Para proteger a los demás titulares podemos pedirte un antecedente
          que acredite que el inmueble o el dato te concierne. El ejercicio de estos derechos es
          gratuito y responderemos dentro de los plazos que fija la ley.
        </p>
        <p>
          Si no quedas conforme con la respuesta, puedes reclamar ante la Agencia de Protección de
          Datos Personales.
        </p>
      </Seccion>

      <Seccion titulo="10. Cómo excluirte de la analítica">
        <p>
          Si tu navegador envía la señal Do Not Track o Global Privacy Control, no registramos
          ningún evento de uso.
        </p>
      </Seccion>

      <Seccion titulo="11. Cambios a esta política">
        <p>
          Si cambia lo que el sitio trata o publica, actualizaremos esta página y su fecha
          de vigencia. La versión vigente es la del {FECHA}.
        </p>
      </Seccion>
    </main>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-black/10 pt-6 text-sm dark:border-white/10">
      <h2 className="text-base font-medium">{titulo}</h2>
      <div className="mt-3 space-y-3 opacity-85">{children}</div>
    </section>
  );
}
