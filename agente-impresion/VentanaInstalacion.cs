using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

/**
 * La pantalla que ve quien instala el agente.
 *
 * Antes la instalación era una carpeta con un script de PowerShell, un clic
 * derecho, una consola negra y un archivo de texto donde pegar el código a
 * mano. Funcionaba, pero le pide a alguien que no es técnico que haga cosas
 * que dan miedo hacer mal.
 *
 * Ahora es un solo archivo: se abre, se pega el código y se aprieta Instalar.
 * El mismo programa se copia donde corresponde, se deja arrancando con
 * Windows, acomoda la ticketera y se queda trabajando al lado del reloj.
 */
public class VentanaInstalacion : Form
{
    /** Queda en true si la instalación terminó bien y el agente puede seguir. */
    public bool Instalado = false;

    const string TITULO = "Agente de impresión";
    const string PRODUCTO = "AGROCAR ERP";
    const string MARCA = "Promptive";
    const string EMPRESA_MARCA = "Luciérnaga y Asociados S.A.C.";

    // Paleta: el gris pizarra es de la marca, el amarillo es el del ERP y se
    // usa solo en el botón, que es lo único que hay que apretar.
    static readonly Color Pizarra = Color.FromArgb(17, 24, 39);
    static readonly Color PizarraSuave = Color.FromArgb(55, 65, 81);
    static readonly Color Amarillo = Color.FromArgb(251, 230, 0);
    static readonly Color Verde = Color.FromArgb(22, 163, 74);
    static readonly Color Rojo = Color.FromArgb(185, 28, 28);
    static readonly Color Borde = Color.FromArgb(209, 213, 219);

    TextBox campoCodigo;
    Button botonInstalar;
    Label estado;
    Panel paso2;

    public VentanaInstalacion()
    {
        Text = TITULO + " · " + PRODUCTO;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(560, 448);
        BackColor = Color.White;
        Font = new Font("Segoe UI", 9.5f);
        try { Icon = IconoPropio(); } catch { }

        ConstruirEncabezado();
        ConstruirCuerpo();
        ConstruirPie();

        // El codigo se acaba de copiar del ERP, asi que lo normal es que ya
        // este en el portapapeles: se toma solo y queda un paso menos.
        // Si quedo listo, el foco va al boton: solo falta Enter.
        AcceptButton = null;
        Shown += delegate
        {
            PegarDelPortapapeles(true);
            if (botonInstalar.Enabled) { AcceptButton = botonInstalar; botonInstalar.Focus(); }
            else campoCodigo.Focus();
        };
    }

    /**
     * Trae el codigo del portapapeles.
     *
     * Se lee directo y no se depende de que el pegado del cuadro de texto se
     * comporte bien con un texto de varios renglones.
     */
    void PegarDelPortapapeles() { PegarDelPortapapeles(false); }

    void PegarDelPortapapeles(bool silencioso)
    {
        string texto = null;
        try { if (Clipboard.ContainsText()) texto = Clipboard.GetText(); } catch { }

        if (string.IsNullOrEmpty(texto))
        {
            if (!silencioso) Aviso("No hay nada copiado", Rojo);
            return;
        }
        if (SacarCodigo(texto) == null)
        {
            if (!silencioso) Aviso("Lo copiado no tiene un código de computadora", Rojo);
            return;
        }
        campoCodigo.Text = texto.Trim();
        campoCodigo.SelectionStart = campoCodigo.TextLength;
        RevisarCodigo();
    }

    /** El icono de la ventana y de la barra de tareas. */
    static Icon IconoPropio()
    {
        Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("icono");
        if (s != null) using (s) return new Icon(s, 32, 32);
        return Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    }

    /**
     * El isotipo para el encabezado, desde el PNG original.
     *
     * No desde el .ico: el logo es más alto que ancho y las medidas que guarda
     * el icono no son cuadradas, así que pedirle 48×48 devuelve una imagen
     * estirada que sale como ruido. El PNG conserva la proporción.
     */
    static Image Isotipo()
    {
        Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("isotipo");
        if (s == null) return null;
        using (s) return Image.FromStream(s);
    }

    void ConstruirEncabezado()
    {
        var banda = new Panel();
        banda.Dock = DockStyle.Top;
        banda.Height = 92;
        banda.BackColor = Pizarra;

        try
        {
            Image iso = Isotipo();
            if (iso != null)
            {
                var logo = new PictureBox();
                logo.Image = iso;
                logo.SizeMode = PictureBoxSizeMode.Zoom;
                logo.Bounds = new Rectangle(26, 18, 44, 56);
                logo.BackColor = Color.Transparent;
                banda.Controls.Add(logo);
            }
        }
        catch { }

        var t = new Label();
        t.Text = TITULO;
        t.ForeColor = Color.White;
        t.Font = new Font("Segoe UI", 15f, FontStyle.Bold);
        t.Bounds = new Rectangle(88, 22, 400, 28);
        t.BackColor = Color.Transparent;
        banda.Controls.Add(t);

        var st = new Label();
        st.Text = PRODUCTO + "   ·   por " + MARCA;
        st.ForeColor = Color.FromArgb(156, 163, 175);
        st.Font = new Font("Segoe UI", 9f);
        st.Bounds = new Rectangle(90, 52, 400, 20);
        st.BackColor = Color.Transparent;
        banda.Controls.Add(st);

        Controls.Add(banda);
    }

    void ConstruirCuerpo()
    {
        var cuerpo = new Panel();
        cuerpo.Bounds = new Rectangle(0, 92, 560, 308);
        cuerpo.BackColor = Color.White;

        cuerpo.Controls.Add(Paso(1,
            "En el ERP, entra a  Configuración  ›  Impresión de tickets",
            "Escribe un nombre para esta computadora, por ejemplo «Caja principal»,\n" +
            "presiona Agregar y luego Copiar código.",
            24));

        paso2 = Paso(2, "Pega aquí ese código",
            "Puedes pegar solo el código o el bloque completo; se entiende igual.", 118);
        cuerpo.Controls.Add(paso2);

        /*
         * De varias lineas a proposito.
         *
         * Lo que se copia del ERP son dos renglones —la direccion y el
         * codigo—. En un campo de una sola linea, pegarlo dejaba el cuadro
         * aparentemente vacio y el aviso de codigo incompleto, sin que se
         * entendiera que habia pasado. Aca se ve todo lo que se pego.
         */
        campoCodigo = new TextBox();
        campoCodigo.Bounds = new Rectangle(52, 182, 352, 52);
        campoCodigo.Font = new Font("Consolas", 9.5f);
        campoCodigo.BorderStyle = BorderStyle.FixedSingle;
        campoCodigo.Multiline = true;
        campoCodigo.ScrollBars = ScrollBars.Vertical;
        campoCodigo.TextChanged += delegate { RevisarCodigo(); };
        cuerpo.Controls.Add(campoCodigo);

        var botonPegar = new Button();
        botonPegar.Text = "Pegar";
        botonPegar.Bounds = new Rectangle(412, 182, 96, 52);
        botonPegar.FlatStyle = FlatStyle.Flat;
        botonPegar.FlatAppearance.BorderColor = Borde;
        botonPegar.BackColor = Color.White;
        botonPegar.ForeColor = Pizarra;
        botonPegar.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        botonPegar.Cursor = Cursors.Hand;
        botonPegar.Click += delegate { PegarDelPortapapeles(); };
        cuerpo.Controls.Add(botonPegar);

        botonInstalar = new Button();
        botonInstalar.Text = "Instalar";
        botonInstalar.Bounds = new Rectangle(52, 248, 456, 44);
        botonInstalar.FlatStyle = FlatStyle.Flat;
        botonInstalar.FlatAppearance.BorderSize = 0;
        botonInstalar.BackColor = Amarillo;
        botonInstalar.ForeColor = Color.Black;
        botonInstalar.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
        botonInstalar.Cursor = Cursors.Hand;
        botonInstalar.Enabled = false;
        botonInstalar.Click += delegate { Instalar(); };
        cuerpo.Controls.Add(botonInstalar);

        Controls.Add(cuerpo);
        cuerpo.BringToFront();
    }

    Panel Paso(int numero, string titulo, string detalle, int y)
    {
        var p = new Panel();
        p.Bounds = new Rectangle(0, y, 560, 88);
        p.BackColor = Color.White;

        var bolita = new Label();
        bolita.Text = numero.ToString();
        bolita.Bounds = new Rectangle(24, 2, 22, 22);
        bolita.TextAlign = ContentAlignment.MiddleCenter;
        bolita.BackColor = Pizarra;
        bolita.ForeColor = Color.White;
        bolita.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
        p.Controls.Add(bolita);

        var t = new Label();
        t.Text = titulo;
        t.Bounds = new Rectangle(52, 3, 480, 20);
        t.ForeColor = Pizarra;
        t.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
        p.Controls.Add(t);

        var d = new Label();
        d.Text = detalle;
        d.Bounds = new Rectangle(52, 26, 480, 42);
        d.ForeColor = PizarraSuave;
        d.Font = new Font("Segoe UI", 9f);
        p.Controls.Add(d);

        return p;
    }

    void ConstruirPie()
    {
        var pie = new Panel();
        pie.Dock = DockStyle.Bottom;
        pie.Height = 48;
        pie.BackColor = Color.FromArgb(249, 250, 251);

        var linea = new Panel();
        linea.Dock = DockStyle.Top;
        linea.Height = 1;
        linea.BackColor = Borde;
        pie.Controls.Add(linea);

        estado = new Label();
        estado.Bounds = new Rectangle(24, 14, 380, 22);
        estado.ForeColor = PizarraSuave;
        estado.Font = new Font("Segoe UI", 9f);
        estado.Text = "";
        pie.Controls.Add(estado);

        var firma = new Label();
        firma.Text = MARCA + " · " + EMPRESA_MARCA;
        firma.Bounds = new Rectangle(240, 14, 296, 22);
        firma.TextAlign = ContentAlignment.MiddleRight;
        firma.ForeColor = Color.FromArgb(156, 163, 175);
        firma.Font = new Font("Segoe UI", 8f);
        pie.Controls.Add(firma);

        Controls.Add(pie);
    }

    /**
     * Saca el código de lo que se haya pegado.
     *
     * Desde el ERP se copia un bloque `url=...` y `token=...`, pero es normal
     * que alguien pegue solo el código. Se acepta cualquiera de las dos cosas
     * en vez de exigir el formato exacto.
     */
    static string SacarCodigo(string texto)
    {
        if (texto == null) return null;
        var m = System.Text.RegularExpressions.Regex.Match(texto,
            @"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
        return m.Success ? m.Value : null;
    }

    static string SacarUrl(string texto)
    {
        if (texto == null) return null;
        var m = System.Text.RegularExpressions.Regex.Match(texto, @"url\s*=\s*(https?://[^\s]+)");
        return m.Success ? m.Groups[1].Value.TrimEnd('/') : null;
    }

    void RevisarCodigo()
    {
        string codigo = SacarCodigo(campoCodigo.Text);
        botonInstalar.Enabled = codigo != null;

        if (campoCodigo.Text.Trim().Length == 0) { Aviso("", PizarraSuave); return; }
        if (codigo != null) { Aviso("Código reconocido: " + codigo.Substring(0, 8) + "…", Verde); return; }
        Aviso("No se reconoce un código. Cópialo de nuevo desde el ERP.", Rojo);
    }

    void Instalar()
    {
        string codigo = SacarCodigo(campoCodigo.Text);
        if (codigo == null) return;

        botonInstalar.Enabled = false;
        campoCodigo.Enabled = false;
        Aviso("Instalando…", PizarraSuave);
        Application.DoEvents();

        try
        {
            string carpeta = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AgrocarERP");
            Directory.CreateDirectory(carpeta);
            string destino = Path.Combine(carpeta, "AgenteImpresionAgrocar.exe");
            string aqui = Application.ExecutablePath;

            // Se copia a una carpeta estable: si el usuario borra la descarga
            // o vacía Descargas, el agente tiene que seguir arrancando.
            if (!string.Equals(aqui, destino, StringComparison.OrdinalIgnoreCase))
                File.Copy(aqui, destino, true);

            string url = SacarUrl(campoCodigo.Text) ?? "https://agrocar-erp-full.vercel.app";
            File.WriteAllText(Path.Combine(carpeta, "agente.config"),
                "# Agente de impresion - " + MARCA + "\r\n" +
                "url=" + url + "\r\n" +
                "token=" + codigo + "\r\n");

            using (var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run", true))
            {
                if (k != null) k.SetValue("AgrocarAgenteImpresion", "\"" + destino + "\"");
            }

            AcomodarTicketera();

            // Arranca desde su carpeta definitiva y este proceso se va: si
            // siguiera corriendo el de la descarga, cerrar esa ventana mataría
            // el agente.
            System.Diagnostics.Process.Start(destino);
            Instalado = false;

            Aviso("Listo", Verde);
            MessageBox.Show(this,
                "El agente quedó instalado y ya está funcionando.\r\n\r\n" +
                "Vas a verlo con su ícono al lado del reloj, y en el ERP esta\r\n" +
                "computadora aparece con un punto verde en menos de un minuto.\r\n\r\n" +
                "Arranca solo cada vez que se prende la computadora.",
                TITULO + " · " + MARCA, MessageBoxButtons.OK, MessageBoxIcon.Information);

            /*
             * Se retira sin vueltas.
             *
             * El que trabaja es el que quedo copiado en su carpeta, y ya esta
             * andando. Si este proceso siguiera vivo, en el Administrador de
             * tareas aparecerian dos con el mismo nombre —uno de ellos siendo
             * solo esta ventana— y no hay forma de que quien mira eso sepa
             * cual es cual.
             */
            Close();
            Environment.Exit(0);
        }
        catch (Exception ex)
        {
            Aviso("No se pudo instalar", Rojo);
            botonInstalar.Enabled = true;
            campoCodigo.Enabled = true;
            MessageBox.Show(this,
                "No se pudo completar la instalación.\r\n\r\n" + ex.Message +
                "\r\n\r\nSi el antivirus lo bloqueó, hay que permitir el programa " +
                "y volver a intentar.",
                TITULO + " · " + MARCA, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    /**
     * Dos arreglos de la ticketera que se hacían a mano.
     *
     * El driver puede quedar apuntando a un puerto que ya no existe —y ahí
     * todo trabajo entra en error sin decir por qué— y el margen final del
     * driver conviene en 15 mm, que es la distancia de la cuchilla al cabezal.
     * Los dos necesitan permisos de administrador; si no los hay, se sigue
     * igual: solo afectan a la impresión por el navegador.
     */
    void AcomodarTicketera()
    {
        try
        {
            string ps =
                "$p = Get-Printer | Where-Object { $_.Name -like '*POS*' -or $_.Name -like '*80*' } | Select-Object -First 1; " +
                "if ($p) { " +
                "  $u = Get-PrinterPort | Where-Object { $_.Name -match '^USB\\d+$' } | Select-Object -First 1; " +
                "  if ($u -and $p.PortName -ne $u.Name) { try { Set-Printer -Name $p.Name -PortName $u.Name } catch {} } " +
                "  try { Set-PrinterProperty -PrinterName $p.Name -PropertyName 'Config:zjTrailingMargin' -Value 'zj15mm' } catch {} " +
                "}";
            var i = new System.Diagnostics.ProcessStartInfo("powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command \"" + ps.Replace("\"", "\\\"") + "\"");
            i.CreateNoWindow = true;
            i.UseShellExecute = false;
            var pr = System.Diagnostics.Process.Start(i);
            if (pr != null) pr.WaitForExit(15000);
        }
        catch { /* son mejoras, no requisitos */ }
    }

    void Aviso(string texto, Color color)
    {
        estado.Text = texto;
        estado.ForeColor = color;
    }
}
