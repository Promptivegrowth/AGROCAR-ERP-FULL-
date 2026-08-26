using System;
using System.Collections.Generic;
using System.Drawing;
using System.Management;
using System.Windows.Forms;

/**
 * Revisión de las impresoras de la computadora.
 *
 * Existe para reparar un destrozo propio: una versión anterior del instalador
 * intentaba apuntar la ticketera al puerto USB y elegía a cuál por el nombre,
 * con un filtro tan ancho —"POS" u "80"— que una HP Smart Tank 580-590 también
 * entraba. En las computadoras donde esa HP aparecía primero, el instalador le
 * cambiaba el puerto y la dejaba sin imprimir.
 *
 * Va acá adentro y no en un script aparte porque el agente ya está instalado en
 * cada computadora: quien lo necesita abre el menú del reloj y lo ve, sin
 * archivos sueltos, sin consola y sin permisos de ejecución.
 *
 * No cambia nada por su cuenta. Muestra cómo está cada impresora, señala las
 * que quedaron mal y ofrece devolverlas, preguntando siempre antes.
 */
public class VentanaImpresoras : Form
{
    const string MARCA = "Promptive";

    static readonly Color Pizarra = Color.FromArgb(17, 24, 39);
    static readonly Color Rojo = Color.FromArgb(185, 28, 28);
    static readonly Color RojoSuave = Color.FromArgb(254, 242, 242);
    static readonly Color Verde = Color.FromArgb(22, 163, 74);

    ListView lista;
    Label resumen;
    Button botonPuerto, botonCola;

    class Fila
    {
        public string Nombre;
        public string Puerto;
        public string Driver;
        public int EnCola;
        public bool Sospechosa;
        public string Motivo;
    }

    public VentanaImpresoras()
    {
        Text = "Impresoras de esta computadora";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(720, 420);
        BackColor = Color.White;
        Font = new Font("Segoe UI", 9f);

        var cabecera = new Label();
        cabecera.Text = "Cómo está cada impresora de esta computadora";
        cabecera.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
        cabecera.ForeColor = Pizarra;
        cabecera.Bounds = new Rectangle(16, 14, 600, 22);
        Controls.Add(cabecera);

        resumen = new Label();
        resumen.Bounds = new Rectangle(16, 38, 690, 34);
        resumen.ForeColor = Color.FromArgb(55, 65, 81);
        Controls.Add(resumen);

        lista = new ListView();
        lista.Bounds = new Rectangle(16, 78, 688, 258);
        lista.View = View.Details;
        lista.FullRowSelect = true;
        lista.GridLines = true;
        lista.MultiSelect = false;
        lista.Columns.Add("Impresora", 300);
        lista.Columns.Add("Puerto", 160);
        lista.Columns.Add("En cola", 70, HorizontalAlignment.Center);
        lista.Columns.Add("Revisión", 150);
        lista.SelectedIndexChanged += delegate { ActualizarBotones(); };
        Controls.Add(lista);

        botonPuerto = Boton("Cambiar el puerto…", 16, 348, 170);
        botonPuerto.Click += delegate { CambiarPuerto(); };
        Controls.Add(botonPuerto);

        botonCola = Boton("Vaciar la cola", 196, 348, 140);
        botonCola.Click += delegate { VaciarCola(); };
        Controls.Add(botonCola);

        var cerrar = Boton("Cerrar", 604, 348, 100);
        cerrar.Click += delegate { Close(); };
        Controls.Add(cerrar);

        var pie = new Label();
        pie.Text = MARCA;
        pie.Bounds = new Rectangle(348, 356, 240, 20);
        pie.TextAlign = ContentAlignment.MiddleRight;
        pie.ForeColor = Color.FromArgb(156, 163, 175);
        pie.Font = new Font("Segoe UI", 8f);
        Controls.Add(pie);

        Cargar();
    }

    static Button Boton(string texto, int x, int y, int ancho)
    {
        var b = new Button();
        b.Text = texto;
        b.Bounds = new Rectangle(x, y, ancho, 34);
        b.FlatStyle = FlatStyle.Flat;
        b.FlatAppearance.BorderColor = Color.FromArgb(209, 213, 219);
        b.BackColor = Color.White;
        b.Cursor = Cursors.Hand;
        return b;
    }

    /**
     * Una impresora de red apuntando a un puerto USB es la marca de lo que
     * hacía el instalador viejo: esas se conectan por WiFi o cable de red y no
     * usan USB nunca.
     */
    static bool Sospechosa(string driver, string puerto, string nombre)
    {
        if (puerto == null || !System.Text.RegularExpressions.Regex.IsMatch(puerto, @"^USB\d+$"))
            return false;
        /*
         * Solo por el driver o por ser una impresora compartida de la red.
         *
         * Antes tambien se marcaba por la marca —Epson, HP, Canon— y eso da
         * falsos positivos: una Epson L3150 se conecta por USB perfectamente.
         * Marcar como rota una que esta bien es peor que no marcarla: invita a
         * "arreglarla" y romperla de verdad.
         */
        string d = (driver ?? "").ToLowerInvariant();
        string n = (nombre ?? "");
        if (n.StartsWith("\\\\")) return true;
        return d.Contains("ipp") || d.Contains("wsd") || d.Contains("network");
    }

    List<Fila> Leer()
    {
        var filas = new List<Fila>();
        try
        {
            using (var busca = new ManagementObjectSearcher("SELECT Name, PortName, DriverName FROM Win32_Printer"))
            foreach (ManagementObject p in busca.Get())
            {
                var f = new Fila();
                f.Nombre = Convert.ToString(p["Name"]);
                f.Puerto = Convert.ToString(p["PortName"]);
                f.Driver = Convert.ToString(p["DriverName"]);
                f.EnCola = TrabajosEnCola(f.Nombre);
                if (Sospechosa(f.Driver, f.Puerto, f.Nombre))
                {
                    f.Sospechosa = true;
                    f.Motivo = "es de red, no va por USB";
                }
                filas.Add(f);
            }

            MarcarPuertosCompartidos(filas);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "No se pudo leer la lista de impresoras.\r\n\r\n" + ex.Message,
                "Impresoras - " + MARCA);
        }
        return filas;
    }

    /**
     * Dos o mas impresoras en el mismo puerto.
     *
     * Este es el rastro que dejo el instalador viejo, y el sintoma real del
     * problema: en la computadora de caja quedaron tres apuntando a USB001 —la
     * ticketera POS-T80 y las dos Epson— asi que los tickets salian por la
     * Epson. Windows acepta el trabajo igual y el agente lo da por impreso.
     *
     * Se marcan todas las que comparten, porque desde afuera no hay forma de
     * saber cual es la que corresponde a ese puerto.
     */
    static void MarcarPuertosCompartidos(List<Fila> filas)
    {
        // Los puertos que no son un dispositivo: varias impresoras pueden
        // compartirlos sin que eso sea un problema.
        var noCuentan = new List<string> { "PORTPROMPT:", "nul:", "SHRFAX:", "" };

        var cuantas = new Dictionary<string, int>();
        foreach (var f in filas)
        {
            string puerto = f.Puerto ?? "";
            if (noCuentan.Contains(puerto)) continue;
            cuantas[puerto] = cuantas.ContainsKey(puerto) ? cuantas[puerto] + 1 : 1;
        }

        foreach (var f in filas)
        {
            string puerto = f.Puerto ?? "";
            if (noCuentan.Contains(puerto)) continue;
            if (!cuantas.ContainsKey(puerto) || cuantas[puerto] < 2) continue;
            f.Sospechosa = true;
            f.Motivo = "comparte puerto con otras " + (cuantas[puerto] - 1);
        }
    }

    static int TrabajosEnCola(string impresora)
    {
        try
        {
            using (var b = new ManagementObjectSearcher(
                "SELECT * FROM Win32_PrintJob WHERE Name LIKE '" + impresora.Replace("'", "''") + "%'"))
                return b.Get().Count;
        }
        catch { return 0; }
    }

    void Cargar()
    {
        lista.Items.Clear();
        var filas = Leer();
        int problemas = 0;
        foreach (var f in filas)
        {
            var it = new ListViewItem(f.Nombre);
            it.SubItems.Add(f.Puerto);
            it.SubItems.Add(f.EnCola > 0 ? f.EnCola.ToString() : "—");
            it.SubItems.Add(f.Sospechosa ? f.Motivo : "bien");
            it.Tag = f;
            it.ForeColor = Pizarra;
            if (f.Sospechosa)
            {
                it.BackColor = RojoSuave;
                it.ForeColor = Rojo;
                problemas++;
            }
            lista.Items.Add(it);
        }

        if (problemas == 0)
        {
            resumen.ForeColor = Verde;
            resumen.Text = "Ninguna impresora quedó apuntando a un puerto que no le corresponde.";
        }
        else
        {
            resumen.ForeColor = Rojo;
            resumen.Text = problemas + " impresora(s) en rojo: son de red o WiFi y están apuntando a un puerto USB.\r\n" +
                           "Elegí una y usá «Cambiar el puerto» para devolverla al suyo.";
        }
        ActualizarBotones();
    }

    Fila Elegida()
    {
        return lista.SelectedItems.Count == 0 ? null : (Fila)lista.SelectedItems[0].Tag;
    }

    void ActualizarBotones()
    {
        var f = Elegida();
        botonPuerto.Enabled = f != null;
        botonCola.Enabled = f != null && f.EnCola > 0;
    }

    static List<string> Puertos()
    {
        var l = new List<string>();
        try
        {
            using (var b = new ManagementObjectSearcher("SELECT Name FROM Win32_TCPIPPrinterPort"))
                foreach (ManagementObject p in b.Get()) l.Add(Convert.ToString(p["Name"]));
        }
        catch { }
        try
        {
            using (var b = new ManagementObjectSearcher("SELECT PortName FROM Win32_Printer"))
                foreach (ManagementObject p in b.Get())
                {
                    string n = Convert.ToString(p["PortName"]);
                    if (!string.IsNullOrEmpty(n) && !l.Contains(n)) l.Add(n);
                }
        }
        catch { }
        return l;
    }

    void CambiarPuerto()
    {
        var f = Elegida();
        if (f == null) return;

        var puertos = Puertos();
        puertos.Remove(f.Puerto);
        if (puertos.Count == 0)
        {
            MessageBox.Show(this, "No hay otros puertos disponibles en esta computadora.",
                "Impresoras - " + MARCA);
            return;
        }

        using (var d = new VentanaElegirPuerto(f.Nombre, f.Puerto, puertos))
        {
            if (d.ShowDialog(this) != DialogResult.OK || d.Elegido == null) return;

            if (MessageBox.Show(this,
                    "Se va a cambiar el puerto de:\r\n\r\n" + f.Nombre +
                    "\r\n\r\nde   " + f.Puerto + "\r\na    " + d.Elegido +
                    "\r\n\r\n¿Continuar?",
                    "Impresoras - " + MARCA,
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;

            try
            {
                using (var b = new ManagementObjectSearcher(
                    "SELECT * FROM Win32_Printer WHERE Name = '" + f.Nombre.Replace("'", "''") + "'"))
                foreach (ManagementObject p in b.Get())
                {
                    p["PortName"] = d.Elegido;
                    p.Put();
                }
                MessageBox.Show(this, "Listo. Conviene imprimir una página de prueba desde Windows para confirmarlo.",
                    "Impresoras - " + MARCA);
                Cargar();
            }
            catch (Exception ex)
            {
                MessageBox.Show(this,
                    "No se pudo cambiar el puerto.\r\n\r\n" + ex.Message +
                    "\r\n\r\nSuele ser por falta de permisos: cerrá esta ventana, cerrá el agente " +
                    "desde el ícono del reloj y volvé a abrirlo como administrador.",
                    "Impresoras - " + MARCA, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }
    }

    void VaciarCola()
    {
        var f = Elegida();
        if (f == null || f.EnCola == 0) return;
        if (MessageBox.Show(this,
                "Se van a descartar los " + f.EnCola + " trabajo(s) que espera " + f.Nombre + ".\r\n\r\n¿Continuar?",
                "Impresoras - " + MARCA, MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        try
        {
            using (var b = new ManagementObjectSearcher(
                "SELECT * FROM Win32_PrintJob WHERE Name LIKE '" + f.Nombre.Replace("'", "''") + "%'"))
                foreach (ManagementObject t in b.Get()) t.Delete();
            Cargar();
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "No se pudo vaciar la cola.\r\n\r\n" + ex.Message, "Impresoras - " + MARCA);
        }
    }
}

/** El cuadro para elegir a qué puerto devolver una impresora. */
public class VentanaElegirPuerto : Form
{
    public string Elegido;
    ListBox lista;

    /**
     * Sirve para dos cosas: elegir el puerto de una impresora y elegir cuál de
     * las impresoras es la ticketera. Son listas distintas, así que el texto
     * de ayuda lo dice quien abre el cuadro — antes hablaba de puertos aunque
     * estuviera mostrando impresoras, y eso confundía justo cuando había que
     * decidir rápido.
     */
    public VentanaElegirPuerto(string impresora, string actual, List<string> puertos)
        : this(impresora, actual, puertos, null) { }

    public VentanaElegirPuerto(string impresora, string actual, List<string> puertos, string ayudaTexto)
    {
        Text = "Elegir el puerto";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;
        ClientSize = new Size(440, 300);
        BackColor = Color.White;
        Font = new Font("Segoe UI", 9f);

        var t = new Label();
        t.Text = impresora + "\r\nEstá en: " + actual;
        t.Bounds = new Rectangle(16, 14, 408, 40);
        Controls.Add(t);

        var ayuda = new Label();
        ayuda.Text = ayudaTexto ?? "Las que se conectan por WiFi o red usan un puerto que empieza con WSD- " +
                     "o que es una dirección IP.";
        ayuda.Bounds = new Rectangle(16, 54, 408, 34);
        ayuda.ForeColor = Color.FromArgb(107, 114, 128);
        Controls.Add(ayuda);

        lista = new ListBox();
        lista.Bounds = new Rectangle(16, 92, 408, 150);
        foreach (string p in puertos) lista.Items.Add(p);
        if (lista.Items.Count > 0) lista.SelectedIndex = 0;
        Controls.Add(lista);

        var ok = new Button();
        ok.Text = ayudaTexto == null ? "Usar este puerto" : "Usar esta impresora";
        ok.Bounds = new Rectangle(224, 252, 130, 32);
        ok.DialogResult = DialogResult.OK;
        ok.Click += delegate { Elegido = lista.SelectedItem as string; };
        Controls.Add(ok);

        var no = new Button();
        no.Text = "Cancelar";
        no.Bounds = new Rectangle(360, 252, 64, 32);
        no.DialogResult = DialogResult.Cancel;
        Controls.Add(no);

        AcceptButton = ok;
        CancelButton = no;
    }
}
