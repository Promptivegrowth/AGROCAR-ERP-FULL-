using System;
using System.Drawing;
using System.Windows.Forms;

/**
 * La ventana del agente, con todo lo que hay que hacer a la vista.
 *
 * Antes esto era un cartel de aviso con un solo botón "Aceptar". Todo lo demás
 * —elegir la impresora, revisar cómo quedaron, imprimir una prueba— vivía en
 * el menú del clic derecho sobre el ícono del reloj, y quien abría la ventana
 * se encontraba con un texto donde nada se podía tocar. Costó una tarde de
 * idas y vueltas antes de que se entendiera que el menú estaba en otro lado.
 *
 * Ahora es una sola ventana: el estado arriba y los botones abajo. El menú del
 * clic derecho sigue existiendo para quien ya lo conoce.
 */
public class VentanaEstado : Form
{
    const string MARCA = "Promptive";

    static readonly Color Pizarra = Color.FromArgb(17, 24, 39);
    static readonly Color Gris = Color.FromArgb(107, 114, 128);
    static readonly Color Verde = Color.FromArgb(22, 163, 74);
    static readonly Color Rojo = Color.FromArgb(185, 28, 28);
    static readonly Color Borde = Color.FromArgb(209, 213, 219);

    /** Lo que la ventana necesita saber, para no acoplarla al agente. */
    public class Datos
    {
        public string Version;
        public string Estado;
        public string UltimoContacto;
        public int Impresos;
        public int Fallidos;
        public string Sistema;
        public string Impresora;
        public string DeDonde;
        public string RutaConfig;
    }

    readonly Datos d;

    /** Qué hacer cuando se aprieta cada botón; lo decide el agente. */
    public Action AlElegirImpresora;
    public Action AlRevisarImpresoras;
    public Action AlImprimirPrueba;

    public VentanaEstado(Datos datos)
    {
        d = datos;
        Text = "Agente de impresión · " + MARCA;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false; MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(470, 340);
        BackColor = Color.White;
        Font = new Font("Segoe UI", 9f);

        Construir();
    }

    void Construir()
    {
        var titulo = new Label();
        titulo.Text = "Agente de impresión AGROCAR";
        titulo.Font = new Font("Segoe UI", 12f, FontStyle.Bold);
        titulo.ForeColor = Pizarra;
        titulo.Bounds = new Rectangle(20, 16, 430, 24);
        Controls.Add(titulo);

        var version = new Label();
        version.Text = "por " + MARCA + "   ·   versión " + d.Version;
        version.ForeColor = Gris;
        version.Bounds = new Rectangle(20, 40, 430, 18);
        Controls.Add(version);

        int y = 72;
        y = Dato("Estado", d.Estado, y, d.Estado != null && d.Estado.StartsWith("esperando") ? Verde : Pizarra);
        y = Dato("Último contacto", d.UltimoContacto, y, Pizarra);
        y = Dato("Tickets impresos", d.Impresos.ToString() + (d.Fallidos > 0 ? "   ·   con problemas: " + d.Fallidos : ""),
                 y, d.Fallidos > 0 ? Rojo : Pizarra);
        y = Dato("Imprime por",
                 d.Impresora == null ? "ninguna encontrada" : d.Impresora + "   (" + d.DeDonde + ")",
                 y, d.Impresora == null ? Rojo : Pizarra);
        y = Dato("Sistema", d.Sistema, y, Gris);

        var linea = new Panel();
        linea.Bounds = new Rectangle(20, y + 8, 430, 1);
        linea.BackColor = Borde;
        Controls.Add(linea);

        var queHacer = new Label();
        queHacer.Text = "Si los tickets no salen o salen por otra impresora:";
        queHacer.ForeColor = Gris;
        queHacer.Bounds = new Rectangle(20, y + 18, 430, 18);
        Controls.Add(queHacer);

        int by = y + 42;
        Controls.Add(Boton("Elegir impresora", 20, by, 140, delegate { if (AlElegirImpresora != null) AlElegirImpresora(); }));
        Controls.Add(Boton("Revisar impresoras", 168, by, 150, delegate { if (AlRevisarImpresoras != null) AlRevisarImpresoras(); }));
        Controls.Add(Boton("Imprimir prueba", 326, by, 124, delegate { if (AlImprimirPrueba != null) AlImprimirPrueba(); }));

        var cerrar = Boton("Cerrar", 350, by + 46, 100, delegate { Close(); });
        cerrar.BackColor = Color.FromArgb(249, 250, 251);
        Controls.Add(cerrar);

        var config = new LinkLabel();
        config.Text = "Ver el archivo de configuración";
        config.Bounds = new Rectangle(20, by + 54, 220, 18);
        config.LinkColor = Gris;
        config.Font = new Font("Segoe UI", 8f);
        config.Click += delegate
        {
            try { System.Diagnostics.Process.Start("notepad.exe", d.RutaConfig); } catch { }
        };
        Controls.Add(config);
    }

    int Dato(string etiqueta, string valor, int y, Color color)
    {
        var e = new Label();
        e.Text = etiqueta;
        e.ForeColor = Gris;
        e.Bounds = new Rectangle(20, y, 120, 18);
        Controls.Add(e);

        var v = new Label();
        v.Text = valor ?? "—";
        v.ForeColor = color;
        v.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
        v.Bounds = new Rectangle(144, y, 306, 18);
        v.AutoEllipsis = true;
        Controls.Add(v);

        return y + 22;
    }

    static Button Boton(string texto, int x, int y, int ancho, EventHandler alTocar)
    {
        var b = new Button();
        b.Text = texto;
        b.Bounds = new Rectangle(x, y, ancho, 34);
        b.FlatStyle = FlatStyle.Flat;
        b.FlatAppearance.BorderColor = Borde;
        b.BackColor = Color.White;
        b.ForeColor = Pizarra;
        b.Cursor = Cursors.Hand;
        b.Click += alTocar;
        return b;
    }
}
