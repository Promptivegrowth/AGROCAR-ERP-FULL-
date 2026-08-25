// ─────────────────────────────────────────────────────────────────────────────
// AGENTE DE IMPRESIÓN AGROCAR — Promptive
//
// Imprime los tickets del ERP en la ticketera térmica.
//
// Por qué existe: el ERP corre en el navegador y desde ahí solo se puede
// imprimir por el driver de Windows, que convierte la página en imagen —673 KB
// por ticket— y decide el corte según el tamaño de papel, agregando su propio
// margen. De ahí venía el papel desperdiciado, y no había forma de pedirle
// "cortá acá". Este programa manda los comandos ESC/POS que arma el ERP, en
// crudo: unos 400 bytes por ticket y el corte lo decide el ticket.
//
// Por qué pregunta en vez de escuchar: la primera versión era un servidor local
// al que el navegador le hablaba, y Chrome y Edge están cerrando esa puerta
// —Local Network Access—. Funcionaba a fuerza de cabeceras y permisos por
// equipo, pero la restricción se endurece con cada versión. Acá se da vuelta la
// relación: el agente le pregunta al ERP si hay algo para imprimir. Un programa
// local no tiene esas restricciones, y de paso se puede facturar desde el
// celular y que el ticket salga en la impresora de la oficina.
//
// Compilar (el compilador viene con Windows, no hay que instalar nada):
//   %SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
//     /target:winexe /out:AgenteImpresionAgrocar.exe
//     /reference:System.Drawing.dll /reference:System.Windows.Forms.dll
//     /win32icon:promptive.ico AgenteImpresion.cs
// ─────────────────────────────────────────────────────────────────────────────

using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

[assembly: AssemblyTitle("Agente de impresion AGROCAR")]
[assembly: AssemblyDescription("Imprime los tickets del ERP en la ticketera")]
[assembly: AssemblyCompany("Promptive")]
[assembly: AssemblyProduct("AGROCAR ERP")]
[assembly: AssemblyCopyright("Promptive - Luciernaga & Asociados S.A.C.")]
[assembly: AssemblyVersion("2.0.0.0")]
[assembly: AssemblyFileVersion("2.0.0.0")]

class Agente
{
    const string VERSION = "2.0";
    const string MARCA = "Promptive";
    /** Salto de linea de Windows, para los mensajes en pantalla. */
    static readonly string SALTO = Environment.NewLine;

    // Cada segundo: suficiente para que el ticket salga apenas se factura, sin
    // castigar al servidor. Si falla la red se va espaciando, ver EsperaActual.
    const int INTERVALO_MS = 1000;

    static string urlBase;
    static string token;
    static string impresora;

    static System.Windows.Forms.NotifyIcon bandeja;
    static int impresos = 0;
    static int fallidos = 0;
    static string ultimoEstado = "iniciando";
    static DateTime ultimoContacto = DateTime.MinValue;
    static int fallosSeguidos = 0;

    // ── Impresión RAW por el spooler ─────────────────────────────────────────
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    class DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
    [DllImport("winspool.Drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.Drv", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool StartDocPrinter(IntPtr h, int lvl, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
    [DllImport("winspool.Drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError = true)]
    static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError = true)]
    static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.Drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr h, IntPtr buf, int n, out int written);

    static string ImprimirRaw(string nombreImpresora, byte[] datos)
    {
        IntPtr hp;
        if (!OpenPrinter(nombreImpresora, out hp, IntPtr.Zero))
            return "no se pudo abrir la impresora " + nombreImpresora + " (error " + Marshal.GetLastWin32Error() + ")";

        var di = new DOCINFO();
        di.pDocName = "AGROCAR ticket";
        di.pDataType = "RAW";
        if (!StartDocPrinter(hp, 1, di)) { ClosePrinter(hp); return "la impresora rechazo el trabajo"; }

        StartPagePrinter(hp);
        IntPtr p = Marshal.AllocCoTaskMem(datos.Length);
        Marshal.Copy(datos, 0, p, datos.Length);
        int escritos;
        bool ok = WritePrinter(hp, p, datos.Length, out escritos);
        Marshal.FreeCoTaskMem(p);
        EndPagePrinter(hp);
        EndDocPrinter(hp);
        ClosePrinter(hp);

        return ok ? null : "no se pudieron enviar los datos a la impresora";
    }

    static List<string> Impresoras()
    {
        var lista = new List<string>();
        try
        {
            foreach (string n in System.Drawing.Printing.PrinterSettings.InstalledPrinters)
                lista.Add(n);
        }
        catch { }
        return lista;
    }

    /**
     * Cual de las impresoras instaladas es la ticketera.
     *
     * Primero por el nombre, que es lo que suele delatarlas. La lista de
     * pistas se quedo corta con la de Daniel —una TEK, que no dice "POS" ni
     * "80mm" por ningun lado— asi que si eso no alcanza se descartan las que
     * no son impresoras de verdad (guardar en PDF, XPS, fax) y, si queda una
     * sola, esa es.
     *
     * Cuando hay varias y ninguna se delata, no se adivina: se elige a mano
     * desde el menu del agente. Mandar un ticket a la impresora equivocada es
     * peor que no imprimirlo.
     */
    static string AdivinarTicketera()
    {
        string[] pistas = {
            "pos-80", "pos80", "pos 80", "thermal", "termica", "térmica",
            "receipt", "ticket", "80mm", "58mm", "pos ", "tek", "xprinter",
            "zjiang", "zj-", "rp80", "t80", "tm-t", "ep-", "gprinter",
        };
        var reales = ImpresorasRealesEnCache();
        foreach (string n in reales)
        {
            string bajo = n.ToLowerInvariant();
            foreach (string pista in pistas)
                if (bajo.Contains(pista)) return n;
        }
        return reales.Count == 1 ? reales[0] : null;
    }

    /**
     * Las impresoras instaladas, sin las que en realidad no imprimen.
     *
     * Windows trae de fabrica varias que son destinos de archivo o servicios
     * en la nube; si se cuela una de esas, el ticket se va a un PDF que nadie
     * abre nunca.
     */
    /*
     * La lista de impresoras se guarda un rato.
     *
     * Preguntarle a Windows cuales hay es una operacion cara —habla con el
     * administrador de impresion— y el ciclo corre una vez por segundo. Se
     * hacia en cada vuelta solo para informarle al ERP que ticketera se esta
     * usando, un dato que no cambia de un segundo al otro. El agente terminaba
     * cerrandose solo.
     */
    static System.Collections.Generic.List<string> impresorasEnCache;
    static DateTime impresorasVistas = DateTime.MinValue;
    const int CACHE_IMPRESORAS_SEG = 60;

    static System.Collections.Generic.List<string> ImpresorasRealesEnCache()
    {
        if (impresorasEnCache == null ||
            (DateTime.Now - impresorasVistas).TotalSeconds > CACHE_IMPRESORAS_SEG)
        {
            try
            {
                impresorasEnCache = ImpresorasReales();
                impresorasVistas = DateTime.Now;
            }
            catch (Exception ex)
            {
                Log("no se pudo leer la lista de impresoras: " + ex.Message);
                if (impresorasEnCache == null)
                    impresorasEnCache = new System.Collections.Generic.List<string>();
            }
        }
        return impresorasEnCache;
    }

    static System.Collections.Generic.List<string> ImpresorasReales()
    {
        string[] falsas = {
            "microsoft print to pdf", "microsoft xps", "onenote", "fax",
            "pdfcreator", "adobe pdf", "enviar a onenote", "print to pdf",
        };
        var lista = new System.Collections.Generic.List<string>();
        foreach (string n in Impresoras())
        {
            string bajo = n.ToLowerInvariant();
            bool falsa = false;
            foreach (string f in falsas) if (bajo.Contains(f)) { falsa = true; break; }
            if (!falsa) lista.Add(n);
        }
        return lista;
    }

    /** Deja anotada en la configuracion la impresora elegida a mano. */
    static void GuardarImpresora(string nombre)
    {
        try
        {
            string ruta = RutaConfig();
            var lineas = new System.Collections.Generic.List<string>();
            if (File.Exists(ruta))
                foreach (string l in File.ReadAllLines(ruta))
                    if (!l.TrimStart().StartsWith("impresora=")) lineas.Add(l);
            if (!string.IsNullOrEmpty(nombre)) lineas.Add("impresora=" + nombre);
            File.WriteAllLines(ruta, lineas.ToArray());
            impresora = string.IsNullOrEmpty(nombre) ? null : nombre;
            Log("impresora elegida a mano: " + (nombre ?? "(automatica)"));
        }
        catch (Exception ex) { Log("no se pudo guardar la impresora: " + ex.Message); }
    }

    // ── Lectura de JSON, a mano para no arrastrar dependencias ───────────────
    static string Campo(string json, string nombre)
    {
        string marca = "\"" + nombre + "\"";
        int i = json.IndexOf(marca, StringComparison.Ordinal);
        if (i < 0) return null;
        i = json.IndexOf(':', i + marca.Length);
        if (i < 0) return null;
        i++;
        while (i < json.Length && (json[i] == ' ' || json[i] == '\t')) i++;
        if (i >= json.Length || json[i] != '"') return null;
        i++;
        var sb = new StringBuilder();
        while (i < json.Length && json[i] != '"')
        {
            if (json[i] == '\\' && i + 1 < json.Length)
            {
                i++;
                if (json[i] == 'n') { sb.Append('\n'); i++; continue; }
                if (json[i] == 'r') { sb.Append('\r'); i++; continue; }
                if (json[i] == 't') { sb.Append('\t'); i++; continue; }
            }
            sb.Append(json[i]);
            i++;
        }
        return sb.ToString();
    }

    /** Separa los objetos del arreglo "trabajos" sin armar un parser completo. */
    static List<string> Trabajos(string json)
    {
        var lista = new List<string>();
        int i = json.IndexOf("\"trabajos\"", StringComparison.Ordinal);
        if (i < 0) return lista;
        i = json.IndexOf('[', i);
        if (i < 0) return lista;

        int nivel = 0, inicio = -1;
        bool enTexto = false, escapado = false;
        for (int k = i; k < json.Length; k++)
        {
            char c = json[k];
            if (enTexto)
            {
                if (escapado) escapado = false;
                else if (c == '\\') escapado = true;
                else if (c == '"') enTexto = false;
                continue;
            }
            if (c == '"') { enTexto = true; continue; }
            if (c == '{') { if (nivel == 0) inicio = k; nivel++; continue; }
            if (c == '}')
            {
                nivel--;
                if (nivel == 0 && inicio >= 0) { lista.Add(json.Substring(inicio, k - inicio + 1)); inicio = -1; }
                continue;
            }
            if (c == ']' && nivel == 0) break;
        }
        return lista;
    }

    // ── Diálogo con el ERP ───────────────────────────────────────────────────
    static string Pedir(string url)
    {
        var req = (HttpWebRequest)WebRequest.Create(url);
        req.Method = "GET";
        req.Timeout = 15000;
        req.UserAgent = "AgenteImpresionAgrocar/" + VERSION;
        using (var resp = (HttpWebResponse)req.GetResponse())
        using (var lector = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
            return lector.ReadToEnd();
    }

    static void Confirmar(string id, bool ok, string error)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(urlBase + "/api/impresion/confirmar");
            req.Method = "POST";
            req.ContentType = "application/json";
            req.Timeout = 15000;
            req.UserAgent = "AgenteImpresionAgrocar/" + VERSION;

            string cuerpo = "{\"token\":\"" + token + "\",\"id\":\"" + id + "\",\"ok\":" +
                            (ok ? "true" : "false") +
                            (error != null ? ",\"error\":\"" + error.Replace("\\", "").Replace("\"", "'") + "\"" : "") + "}";
            byte[] datos = Encoding.UTF8.GetBytes(cuerpo);
            req.ContentLength = datos.Length;
            using (var s = req.GetRequestStream()) s.Write(datos, 0, datos.Length);
            using (var r = req.GetResponse()) { }
        }
        catch { /* si no se pudo confirmar, el ticket se reintenta */ }
    }

    /**
     * Cuánto esperar antes de volver a preguntar.
     *
     * Con la red caída no tiene sentido insistir cada segundo: se va espaciando
     * hasta medio minuto. Apenas hay respuesta, se retoma el ritmo normal.
     */
    static int EsperaActual()
    {
        if (fallosSeguidos == 0) return INTERVALO_MS;
        int espera = INTERVALO_MS * (1 << Math.Min(fallosSeguidos, 5));
        return Math.Min(espera, 30000);
    }

    static void Ciclo()
    {
        Log("agente v" + VERSION + " iniciado - sistema " + urlBase);
        while (true)
        {
            /*
             * Nada de lo que pase adentro puede cerrar el agente.
             *
             * Una excepcion que se escape de un hilo de fondo termina el
             * proceso entero, sin aviso y sin dejar rastro: la computadora se
             * queda sin agente y los tickets se acumulan esperando a alguien
             * que ya no esta. Cualquier falla se anota y se sigue.
             */
            try
            {
                /*
                 * Se informa por que ticketera va a imprimir.
                 *
                 * Asi en el ERP se ve cual computadora esta conectada pero sin
                 * encontrar impresora. Antes esa se veia igual que una que
                 * funciona —con su punto verde— y no habia forma de notarlo
                 * hasta que alguien intentaba facturar.
                 */
                string usaAhora = !string.IsNullOrEmpty(impresora) ? impresora : AdivinarTicketera();
                string url = urlBase + "/api/impresion/pendientes?token=" + Uri.EscapeDataString(token) +
                             "&version=" + Uri.EscapeDataString(VERSION) +
                             "&impresora=" + Uri.EscapeDataString(usaAhora ?? "") +
                             "&impresoras=" + Uri.EscapeDataString(string.Join("|", ImpresorasRealesEnCache().ToArray()));
                string json = Pedir(url);
                fallosSeguidos = 0;
                ultimoContacto = DateTime.Now;

                string impresoraDelServidor = Campo(json, "impresora");
                string usar = !string.IsNullOrEmpty(impresora) ? impresora
                            : (!string.IsNullOrEmpty(impresoraDelServidor) ? impresoraDelServidor : AdivinarTicketera());

                var trabajos = Trabajos(json);
                if (trabajos.Count == 0)
                {
                    ultimoEstado = "esperando tickets";
                }
                else
                {
                    ultimoEstado = "imprimiendo";
                    Log("recibidos " + trabajos.Count + " ticket(s), impresora: " + (usar ?? "NINGUNA"));
                    foreach (string t in trabajos)
                    {
                        string id = Campo(t, "id");
                        string contenido = Campo(t, "contenido");
                        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(contenido)) continue;

                        if (string.IsNullOrEmpty(usar))
                        {
                            Confirmar(id, false, "no hay ninguna ticketera en esta computadora");
                            fallidos++;
                            continue;
                        }

                        byte[] datos;
                        try { datos = Convert.FromBase64String(contenido); }
                        catch { Confirmar(id, false, "el ticket llego mal codificado"); fallidos++; continue; }

                        string fallo = ImprimirRaw(usar, datos);
                        if (fallo == null) { impresos++; Log("impreso " + id); Confirmar(id, true, null); }
                        else { fallidos++; Log("FALLO al imprimir " + id + ": " + fallo); Confirmar(id, false, fallo); }

                        // Respiro entre tickets: el bufer de estas impresoras es
                        // chico y encimarlos hace que se pierda alguno.
                        Thread.Sleep(350);
                    }
                }
            }
            catch (WebException e)
            {
                fallosSeguidos++;
                var resp = e.Response as HttpWebResponse;
                if (resp != null && (int)resp.StatusCode == 401)
                    ultimoEstado = "esta computadora no esta registrada";
                else
                    ultimoEstado = "sin conexion con el sistema";
                if (fallosSeguidos <= 3 || fallosSeguidos % 20 == 0)
                    Log("red: " + ultimoEstado + " (" + e.Message + ")");
            }
            catch (Exception e)
            {
                fallosSeguidos++;
                ultimoEstado = "error: " + e.Message;
                Log("ERROR " + e.GetType().Name + ": " + e.Message);
            }

            // Fuera del try de arriba a proposito, pero protegido: si algo de
            // esto lanzara, el hilo moriria en silencio y el agente quedaria
            // vivo pero sin preguntar nunca mas. Paso exactamente eso.
            try { ActualizarBandeja(); } catch { }
            try { Thread.Sleep(EsperaActual()); } catch { Thread.Sleep(INTERVALO_MS); }
        }
    }

    // ── Configuración ────────────────────────────────────────────────────────
    /**
     * Registro de actividad.
     *
     * El agente corre sin ventana, asi que cuando algo falla no queda rastro.
     * Este archivo es la unica forma de saber que paso en la computadora del
     * cliente sin pedirle que abra nada raro. Se recorta solo para que no
     * crezca sin control.
     */
    static readonly object candadoLog = new object();

    static string RutaLog()
    {
        string dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AgrocarERP");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "agente.log");
    }

    static void Log(string mensaje)
    {
        try
        {
            lock (candadoLog)
            {
                string ruta = RutaLog();
                var info = new FileInfo(ruta);
                if (info.Exists && info.Length > 512 * 1024)
                {
                    // Se conserva la mitad final: lo viejo ya no sirve
                    string[] lineas = File.ReadAllLines(ruta);
                    File.WriteAllLines(ruta, lineas, Encoding.UTF8);
                }
                File.AppendAllText(ruta,
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + mensaje + Environment.NewLine,
                    Encoding.UTF8);
            }
        }
        catch { }
    }

    static string RutaConfig()
    {
        string dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AgrocarERP");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "agente.config");
    }

    /** Formato clave=valor: se puede abrir y corregir con el Bloc de notas. */
    static void LeerConfig()
    {
        urlBase = "https://agrocar-erp-full.vercel.app";
        token = null;
        impresora = null;

        string ruta = RutaConfig();
        if (!File.Exists(ruta)) return;
        foreach (string linea in File.ReadAllLines(ruta))
        {
            string l = linea.Trim();
            if (l.Length == 0 || l.StartsWith("#")) continue;
            int i = l.IndexOf('=');
            if (i <= 0) continue;
            string clave = l.Substring(0, i).Trim().ToLowerInvariant();
            string valor = l.Substring(i + 1).Trim();
            if (clave == "url") urlBase = valor.TrimEnd('/');
            else if (clave == "token") token = valor;
            else if (clave == "impresora") impresora = valor;
        }
    }

    [STAThread]
    static void Main(string[] args)
    {
        /**
         * TLS 1.2.
         *
         * .NET Framework negocia por defecto protocolos viejos que los
         * servidores ya no aceptan, y la conexion falla con "no se puede crear
         * un canal seguro SSL/TLS" sin mas explicacion. Paso exactamente eso:
         * el agente arrancaba, no lograba hablar con el ERP y quedaba vivo
         * pero mudo. Se piden los protocolos modernos de forma explicita.
         */
        try
        {
            System.Net.ServicePointManager.SecurityProtocol =
                (SecurityProtocolType)3072 |    // TLS 1.2
                (SecurityProtocolType)12288;    // TLS 1.3 donde exista
        }
        catch
        {
            try { System.Net.ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; } catch { }
        }

        LeerConfig();

        /*
         * El candado se toma solo para trabajar, no para instalar.
         *
         * Dos agentes escuchando la misma cola es peor que ninguno: los dos
         * levantan el mismo ticket y el comprobante sale impreso dos veces.
         *
         * Pero el candado no puede tomarse antes de saber que se va a hacer.
         * Cuando lo tomaba de entrada, el instalador se lo quedaba, lanzaba al
         * agente recien copiado y ese agente se chocaba contra su propio
         * instalador: mostraba "ya esta funcionando" y no arrancaba. La
         * instalacion terminaba sin dejar nada corriendo.
         *
         * Es por sesion de Windows y no global: en una computadora compartida,
         * cada usuario es una instalacion distinta.
         */
        Mutex candado = null;
        if (!string.IsNullOrEmpty(token))
        {
            bool primero;
            candado = new Mutex(true, "AgrocarAgenteImpresionPromptive", out primero);
            if (!primero)
            {
                var r = System.Windows.Forms.MessageBox.Show(
                    "El agente de impresion ya esta funcionando en esta computadora." + SALTO + SALTO +
                    "Lo puedes ver con su icono al lado del reloj." + SALTO + SALTO +
                    "Quieres volver a configurarlo con otro codigo?",
                    "Agente de impresion - " + MARCA,
                    System.Windows.Forms.MessageBoxButtons.YesNo,
                    System.Windows.Forms.MessageBoxIcon.Information,
                    System.Windows.Forms.MessageBoxDefaultButton.Button2);

                if (r != System.Windows.Forms.DialogResult.Yes) return;

                // Se cierra el que estaba y se suelta el candado: lo que sigue
                // es una instalacion, y el agente que arranque al final lo va a
                // necesitar libre.
                CerrarOtrasInstancias();
                try { candado.Dispose(); } catch { }
                candado = null;
                try { File.Delete(RutaConfig()); } catch { }
                token = null;
            }
        }

        /*
         * Sin codigo: esta computadora todavia no esta instalada.
         *
         * El mismo archivo hace las dos cosas —instalar y despues trabajar—
         * para que quien lo recibe tenga un solo archivo que abrir.
         */
        if (string.IsNullOrEmpty(token))
        {
            System.Windows.Forms.Application.EnableVisualStyles();
            System.Windows.Forms.Application.SetCompatibleTextRenderingDefault(false);
            using (var v = new VentanaInstalacion())
            {
                System.Windows.Forms.Application.Run(v);
            }
            // La instalacion deja al agente andando desde su carpeta definitiva
            // y este proceso se retira: si siguiera vivo el de la descarga,
            // cerrar esa ventana mataria al agente.
            return;
        }

        /*
         * Si algo se escapa, queda anotado.
         *
         * Una excepcion sin atrapar cierra el proceso en silencio: la
         * computadora se queda sin agente, los tickets se acumulan y desde el
         * ERP se ve como "no conectada", sin ninguna pista de que paso. Al
         * menos que quede escrito en el registro.
         */
        AppDomain.CurrentDomain.UnhandledException += delegate(object o, UnhandledExceptionEventArgs ev)
        {
            try { Log("SE CERRO POR UN ERROR: " + (ev.ExceptionObject != null ? ev.ExceptionObject.ToString() : "?")); }
            catch { }
        };
        System.Windows.Forms.Application.ThreadException += delegate(object o, System.Threading.ThreadExceptionEventArgs ev)
        {
            try { Log("error en la ventana: " + ev.Exception); } catch { }
        };

        IniciarBandeja();

        var hilo = new Thread(new ThreadStart(Ciclo));
        hilo.IsBackground = true;
        hilo.Start();

        System.Windows.Forms.Application.Run();
        try { candado.ReleaseMutex(); } catch { }
    }

    /** Cierra cualquier otro agente de este mismo usuario. */
    static void CerrarOtrasInstancias()
    {
        try
        {
            var yo = System.Diagnostics.Process.GetCurrentProcess();
            foreach (var p in System.Diagnostics.Process.GetProcessesByName(yo.ProcessName))
            {
                if (p.Id == yo.Id) continue;
                try { p.Kill(); p.WaitForExit(4000); } catch { }
            }
        }
        catch { }
    }

    static void ActualizarBandeja()
    {
        if (bandeja == null) return;
        try
        {
            string txt = "Impresion AGROCAR - " + ultimoEstado;
            if (impresos > 0) txt += " (" + impresos + ")";
            // El tooltip de Windows corta a los 63 caracteres
            bandeja.Text = txt.Length > 62 ? txt.Substring(0, 62) : txt;
        }
        catch { }
    }

    static void IniciarBandeja()
    {
        try
        {
            bandeja = new System.Windows.Forms.NotifyIcon();
            try
            {
                bandeja.Icon = System.Drawing.Icon.ExtractAssociatedIcon(
                    Assembly.GetExecutingAssembly().Location);
            }
            catch { bandeja.Icon = System.Drawing.SystemIcons.Application; }

            bandeja.Text = "Impresion AGROCAR - " + MARCA;
            bandeja.Visible = true;

            var menu = new System.Windows.Forms.ContextMenuStrip();

            var titulo = new System.Windows.Forms.ToolStripMenuItem("Agente de impresion AGROCAR");
            titulo.Enabled = false;
            menu.Items.Add(titulo);

            var porQuien = new System.Windows.Forms.ToolStripMenuItem("por " + MARCA + " - v" + VERSION);
            porQuien.Enabled = false;
            menu.Items.Add(porQuien);

            menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());

            var estado = new System.Windows.Forms.ToolStripMenuItem("Ver estado");
            estado.Click += delegate(object s, EventArgs e)
            {
                var sb = new StringBuilder();
                sb.AppendLine("Agente de impresion AGROCAR");
                sb.AppendLine("por " + MARCA + "  -  version " + VERSION);
                sb.AppendLine();
                sb.AppendLine("Estado: " + ultimoEstado);
                sb.AppendLine("Ultimo contacto: " +
                    (ultimoContacto == DateTime.MinValue ? "todavia ninguno" : ultimoContacto.ToString("HH:mm:ss")));
                sb.AppendLine("Tickets impresos: " + impresos);
                if (fallidos > 0) sb.AppendLine("Con problemas: " + fallidos);
                sb.AppendLine();
                sb.AppendLine("Sistema: " + urlBase);
                sb.AppendLine("Impresora: " + (impresora ?? AdivinarTicketera() ?? "(ninguna encontrada)"));
                sb.AppendLine("Configuracion: " + RutaConfig());
                sb.AppendLine();
                sb.AppendLine("Impresoras de esta computadora:");
                foreach (string n in Impresoras()) sb.AppendLine("  - " + n);
                System.Windows.Forms.MessageBox.Show(sb.ToString(), "Agente de impresion - " + MARCA);
            };
            menu.Items.Add(estado);

            /*
             * Elegir la impresora a mano.
             *
             * La deteccion por nombre no da con todas: la ticketera de Daniel
             * es una TEK y no dice "POS" ni "80mm" en ningun lado, asi que el
             * agente instalaba bien y despues no encontraba a donde imprimir.
             * Aca se ve la lista de las que tiene Windows y se marca cual es.
             */
            var elegirImpresora = new System.Windows.Forms.ToolStripMenuItem("Elegir impresora");
            elegirImpresora.DropDownOpening += delegate(object s, EventArgs e)
            {
                elegirImpresora.DropDownItems.Clear();
                string actual = impresora ?? AdivinarTicketera();

                var automatica = new System.Windows.Forms.ToolStripMenuItem("Detectar sola");
                automatica.Checked = string.IsNullOrEmpty(impresora);
                automatica.Click += delegate(object s2, EventArgs e2)
                {
                    GuardarImpresora(null);
                    ActualizarBandeja();
                };
                elegirImpresora.DropDownItems.Add(automatica);
                elegirImpresora.DropDownItems.Add(new System.Windows.Forms.ToolStripSeparator());

                var reales = ImpresorasReales();
                if (reales.Count == 0)
                {
                    var vacio = new System.Windows.Forms.ToolStripMenuItem("(Windows no tiene ninguna instalada)");
                    vacio.Enabled = false;
                    elegirImpresora.DropDownItems.Add(vacio);
                    return;
                }
                foreach (string nombre in reales)
                {
                    string n = nombre;
                    var it = new System.Windows.Forms.ToolStripMenuItem(n);
                    it.Checked = (n == actual);
                    it.Click += delegate(object s2, EventArgs e2)
                    {
                        GuardarImpresora(n);
                        ActualizarBandeja();
                        System.Windows.Forms.MessageBox.Show(
                            "Los tickets van a salir por:" + SALTO + SALTO + n,
                            "Agente de impresion - " + MARCA);
                    };
                    elegirImpresora.DropDownItems.Add(it);
                }
            };
            menu.Items.Add(elegirImpresora);

            /*
             * Revisar las impresoras de la computadora.
             *
             * Va en el menu del agente y no en un script aparte porque el
             * agente ya esta instalado en cada maquina: quien lo necesita lo
             * encuentra ahi, sin archivos sueltos ni consola.
             */
            var revisar = new System.Windows.Forms.ToolStripMenuItem("Revisar impresoras de esta PC");
            revisar.Click += delegate(object s, EventArgs e)
            {
                try { using (var v = new VentanaImpresoras()) v.ShowDialog(); }
                catch (Exception ex)
                {
                    System.Windows.Forms.MessageBox.Show(
                        "No se pudo abrir la revision." + SALTO + SALTO + ex.Message,
                        "Agente de impresion - " + MARCA);
                }
            };
            menu.Items.Add(revisar);

            var probar = new System.Windows.Forms.ToolStripMenuItem("Imprimir una prueba");
            probar.Click += delegate(object s, EventArgs e)
            {
                string usar = impresora ?? AdivinarTicketera();
                if (string.IsNullOrEmpty(usar))
                {
                    System.Windows.Forms.MessageBox.Show(
                        "No hay ninguna ticketera elegida." + SALTO + SALTO +
                        "Usa \"Elegir impresora\" en este mismo menu y marca cual es.",
                        "Agente de impresion - " + MARCA);
                    return;
                }
                // El salto de linea va como byte y no dentro del texto: el
                // ticket no es una cadena de Windows sino ordenes para la
                // impresora.
                var t = new System.Collections.Generic.List<byte>();
                Action<string> renglon = delegate(string txt)
                {
                    t.AddRange(Encoding.ASCII.GetBytes(txt));
                    t.Add(0x0a);
                };
                t.AddRange(new byte[] { 0x1b, 0x40 });        // reiniciar
                t.AddRange(new byte[] { 0x1b, 0x61, 0x01 });  // centrar
                renglon("AGROCAR");
                renglon("Prueba de impresion");
                renglon(DateTime.Now.ToString("dd/MM/yyyy HH:mm"));
                renglon(usar);
                t.AddRange(new byte[] { 0x1b, 0x4a, 120 });        // avanzar hasta la cuchilla
                t.AddRange(new byte[] { 0x1d, 0x56, 0x42, 0x00 }); // cortar
                string err = ImprimirRaw(usar, t.ToArray());
                System.Windows.Forms.MessageBox.Show(
                    err == null
                        ? "Salio la prueba por:" + SALTO + SALTO + usar
                        : "No se pudo imprimir en:" + SALTO + usar + SALTO + SALTO + err,
                    "Agente de impresion - " + MARCA);
            };
            menu.Items.Add(probar);

            menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());

            var abrirConfig = new System.Windows.Forms.ToolStripMenuItem("Abrir configuracion");
            abrirConfig.Click += delegate(object s, EventArgs e)
            {
                try { System.Diagnostics.Process.Start("notepad.exe", RutaConfig()); } catch { }
            };
            menu.Items.Add(abrirConfig);

            menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());

            var salir = new System.Windows.Forms.ToolStripMenuItem("Cerrar el agente");
            salir.Click += delegate(object s, EventArgs e)
            {
                bandeja.Visible = false;
                System.Windows.Forms.Application.Exit();
            };
            menu.Items.Add(salir);

            bandeja.ContextMenuStrip = menu;
            bandeja.DoubleClick += delegate(object s, EventArgs e) { estado.PerformClick(); };
        }
        catch { /* sin bandeja el agente igual imprime */ }
    }
}
